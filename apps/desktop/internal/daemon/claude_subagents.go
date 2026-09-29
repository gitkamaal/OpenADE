package daemon

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Claude's stream-json interleaves the parent and Agent/Task child feeds.
// Keep tagged frames out of the parent transcript and give each spawn its own
// bounded document. The same document API and chat renderer serve Codex.
type claudeSubagents struct {
	*codexSubagents
	generation int64
	carry      []byte
	tasks      map[string]string // Claude task ID -> Agent/Task tool_use ID
	pending    map[string][][]byte
	pendingLen int
	lastModel  string
	context    ProviderContext
}

func newClaudeSubagents(store *Store, dataDir, sessionID string, generation int64) *claudeSubagents {
	s := &claudeSubagents{codexSubagents: newCodexSubagents(store, dataDir, sessionID, ""), generation: generation, tasks: map[string]string{}, pending: map[string][][]byte{}}
	var saved string
	if store.db.QueryRow(`SELECT state FROM provider_context WHERE session_id=?`, sessionID).Scan(&saved) == nil {
		_ = json.Unmarshal([]byte(saved), &s.context)
	}
	return s
}

type claudeWireBlock struct {
	Type, ID, Name, Text string
	ToolUseID            string `json:"tool_use_id"`
	IsError              bool   `json:"is_error"`
	Input                map[string]any
}

type claudeWireFrame struct {
	Type, Subtype, Parent, ToolUseID, TaskID, SubagentType, Status string
	Message                                                        struct {
		Content []claudeWireBlock          `json:"content"`
		Model   string                     `json:"model"`
		Usage   map[string]json.RawMessage `json:"usage"`
	} `json:"message"`
	ModelUsage map[string]struct {
		CanonicalModel string          `json:"canonicalModel"`
		ContextWindow  json.RawMessage `json:"contextWindow"`
	} `json:"modelUsage"`
}

func claudeCount(raw json.RawMessage) (uint64, bool) {
	var count uint64
	if len(raw) == 0 || json.Unmarshal(raw, &count) != nil {
		return 0, false
	}
	return count, true
}

func (s *claudeSubagents) saveContext() {
	encoded, err := json.Marshal(s.context)
	if err == nil {
		_, _ = s.store.db.Exec(`INSERT INTO provider_context(session_id,state) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state`, s.sessionID, string(encoded))
	}
}

func (s *claudeSubagents) recordContext(frame *claudeWireFrame) {
	if frame.Type == "assistant" {
		if frame.Message.Model != "" {
			s.lastModel = frame.Message.Model
		}
		var tokens uint64
		var found bool
		for _, field := range []string{"input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"} {
			if count, ok := claudeCount(frame.Message.Usage[field]); ok {
				found = true
				if count > math.MaxUint64-tokens {
					tokens = math.MaxUint64
				} else {
					tokens += count
				}
			}
		}
		if found && (s.context.Tokens == nil || *s.context.Tokens != tokens) {
			s.context.Tokens = &tokens
			s.saveContext()
		}
		return
	}
	if frame.Type != "result" || len(frame.ModelUsage) == 0 {
		return
	}
	entry, ok := frame.ModelUsage[s.lastModel]
	if !ok && s.lastModel != "" {
		for _, candidate := range frame.ModelUsage {
			if candidate.CanonicalModel == s.lastModel {
				entry, ok = candidate, true
				break
			}
		}
	}
	if !ok && len(frame.ModelUsage) == 1 {
		for _, candidate := range frame.ModelUsage {
			entry, ok = candidate, true
		}
	}
	var window *uint64
	if ok {
		if count, valid := claudeCount(entry.ContextWindow); valid && count > 0 {
			window = &count
		}
	}
	if (s.context.Window == nil) != (window == nil) || (window != nil && *s.context.Window != *window) {
		s.context.Window = window
		s.saveContext()
	}
}

func (s *claudeSubagents) consume(chunk []byte) []byte {
	s.carry = append(s.carry, chunk...)
	var out []byte
	for {
		end := bytes.IndexByte(s.carry, '\n')
		if end < 0 {
			break
		}
		line := append([]byte(nil), s.carry[:end]...)
		s.carry = s.carry[end+1:]
		out = append(out, s.line(line)...)
	}
	// Never let an untrusted CLI hold an unbounded partial JSON object.
	if len(s.carry) > maxPendingChildBytes {
		out = append(out, []byte("{\"type\":\"error\",\"message\":\"Claude event exceeded the 4 MiB limit and was omitted.\"}\n")...)
		s.carry = nil
	}
	return out
}

func (s *claudeSubagents) flush() []byte {
	if len(s.carry) == 0 {
		return nil
	}
	line := s.carry
	s.carry = nil
	return s.line(line)
}

func (s *claudeSubagents) line(raw []byte) []byte {
	var frame claudeWireFrame
	// These fields use snake_case in Claude's wire protocol.
	var envelope map[string]json.RawMessage
	if json.Unmarshal(raw, &envelope) != nil {
		return append(raw, '\n')
	}
	if json.Unmarshal(raw, &frame) != nil {
		var parent string
		_ = json.Unmarshal(envelope["parent_tool_use_id"], &parent)
		if parent != "" {
			return nil // malformed child frame must not leak into the parent chat
		}
		return append(raw, '\n')
	}
	_ = json.Unmarshal(envelope["parent_tool_use_id"], &frame.Parent)
	_ = json.Unmarshal(envelope["tool_use_id"], &frame.ToolUseID)
	_ = json.Unmarshal(envelope["task_id"], &frame.TaskID)
	_ = json.Unmarshal(envelope["subagent_type"], &frame.SubagentType)
	if frame.Type == "system" {
		if frame.Subtype == "task_started" && frame.SubagentType != "" && frame.TaskID != "" && frame.ToolUseID != "" {
			s.tasks[frame.TaskID] = frame.ToolUseID
		}
		if frame.Subtype == "task_notification" && frame.ToolUseID != "" {
			if doc := s.bySpawn[frame.ToolUseID]; doc != nil {
				s.finish(doc, frame.Status)
			}
		}
	}
	if frame.Parent != "" {
		if len(frame.Parent) > 256 {
			return nil
		}
		if s.bySpawn[frame.Parent] == nil {
			if len(raw) <= maxPendingChildBytes && s.pendingLen+len(raw) <= maxPendingChildBytes && (len(s.pending) < 32 || s.pending[frame.Parent] != nil) {
				s.pending[frame.Parent] = append(s.pending[frame.Parent], append([]byte(nil), raw...))
				s.pendingLen += len(raw)
			}
		} else {
			s.childLine(frame.Parent, raw, &frame)
		}
		return nil
	}
	s.recordContext(&frame)
	out := append(raw, '\n')
	if frame.Type == "user" {
		s.settleToolResults(frame.Message.Content)
		return out
	}
	if frame.Type != "assistant" {
		return out
	}
	for _, block := range frame.Message.Content {
		if block.Type != "tool_use" || block.ID == "" || len(block.ID) > 256 {
			continue
		}
		if block.Name == "SendMessage" {
			s.forwardMessage(block)
			continue
		}
		if (block.Name == "Agent" || block.Name == "Task") && s.spawn(block) != nil {
			marker, _ := json.Marshal(s.spawnMarker(s.bySpawn[block.ID]))
			out = append(out, marker...)
			out = append(out, '\n')
		}
	}
	return out
}

func (s *claudeSubagents) spawn(block claudeWireBlock) *subagentDoc {
	if block.ID == "" || len(block.ID) > 256 {
		return nil
	}
	if doc := s.bySpawn[block.ID]; doc != nil {
		return doc
	}
	if len(s.bySpawn) >= 128 {
		return nil
	}
	title, _ := block.Input["description"].(string)
	if title == "" {
		title = "Agent"
	}
	doc := &subagentDoc{ID: uuid.NewString(), SpawnID: block.ID, ChildThreadID: fmt.Sprintf("claude-tool:%d:%s", s.generation, block.ID), Title: clipSubagentText(title, 100), Status: "running"}
	if _, err := s.store.db.Exec(`INSERT INTO subagent_docs(id,session_id,generation,spawn_item_id,child_thread_id,title,status,updated_at) VALUES(?,?,?,?,?,?,?,?)`, doc.ID, s.sessionID, s.generation, doc.SpawnID, doc.ChildThreadID, doc.Title, doc.Status, encodeTime(time.Now())); err != nil {
		return nil
	}
	s.bySpawn[block.ID] = doc
	if prompt, _ := block.Input["prompt"].(string); strings.TrimSpace(prompt) != "" {
		s.write(doc, map[string]any{"type": "openade.user_message", "text": clipSubagentText(prompt, 64*1024)})
	}
	for _, early := range s.pending[block.ID] {
		var earlyFrame claudeWireFrame
		if json.Unmarshal(early, &earlyFrame) == nil {
			s.childLine(block.ID, early, &earlyFrame)
		}
		s.pendingLen -= len(early)
	}
	delete(s.pending, block.ID)
	return doc
}

func (s *claudeSubagents) spawnMarker(doc *subagentDoc) map[string]string {
	return map[string]string{"type": "openade.subagent", "id": doc.SpawnID, "doc_id": doc.ID, "title": doc.Title}
}

func (s *claudeSubagents) settleToolResults(blocks []claudeWireBlock) {
	for _, block := range blocks {
		if block.Type != "tool_result" {
			continue
		}
		if doc := s.bySpawn[block.ToolUseID]; doc != nil {
			if block.IsError {
				s.setStatus(doc, "failed")
			} else {
				s.setStatus(doc, "done")
			}
		}
	}
}

func (s *claudeSubagents) forwardMessage(block claudeWireBlock) {
	to, _ := block.Input["to"].(string)
	if to == "" {
		to, _ = block.Input["recipient"].(string)
	}
	message, _ := block.Input["message"].(string)
	if message == "" {
		message, _ = block.Input["content"].(string)
	}
	if doc := s.bySpawn[s.tasks[to]]; doc != nil && strings.TrimSpace(message) != "" {
		s.setStatus(doc, "running")
		s.write(doc, map[string]any{"type": "openade.user_message", "text": clipSubagentText(message, 64*1024)})
	}
}

func (s *claudeSubagents) childLine(spawnID string, raw []byte, frame *claudeWireFrame) {
	doc := s.bySpawn[spawnID]
	if doc == nil {
		return
	}
	if doc.Status != "running" {
		// A real tagged user message can reopen a completed child; tool
		// results and synthetic interruption markers cannot.
		if frame.Type != "user" {
			return
		}
		for _, block := range frame.Message.Content {
			if block.Type == "text" && strings.TrimSpace(block.Text) != "" && !strings.HasPrefix(block.Text, "[Request interrupted") && !strings.HasPrefix(block.Text, "<system-reminder>") {
				s.setStatus(doc, "running")
				break
			}
		}
		if doc.Status != "running" {
			return
		}
	}
	if frame.Type == "assistant" {
		for _, block := range frame.Message.Content {
			if block.Type != "tool_use" || block.ID == "" || len(block.ID) > 256 {
				continue
			}
			if block.Name == "SendMessage" {
				s.forwardMessage(block)
			} else if (block.Name == "Agent" || block.Name == "Task") && block.ID != spawnID {
				if nested := s.spawn(block); nested != nil {
					s.write(doc, s.spawnMarker(nested))
				}
			}
		}
	}
	if frame.Type == "user" {
		s.settleToolResults(frame.Message.Content)
		for _, block := range frame.Message.Content {
			if block.Type == "text" && strings.TrimSpace(block.Text) != "" && !strings.HasPrefix(block.Text, "[Request interrupted") && !strings.HasPrefix(block.Text, "<system-reminder>") {
				s.write(doc, map[string]any{"type": "openade.user_message", "text": clipSubagentText(block.Text, 64*1024)})
			}
		}
	}
	// The child renderer understands the same Claude frames as the parent.
	// Strip only the ownership tag so it cannot accidentally create a new
	// parent/child relationship when the document is viewed later.
	var clean map[string]any
	if json.Unmarshal(raw, &clean) == nil {
		delete(clean, "parent_tool_use_id")
		s.write(doc, clean)
	}
}

func (s *claudeSubagents) finish(doc *subagentDoc, status string) {
	switch status {
	case "completed", "complete", "succeeded", "success":
		s.setStatus(doc, "done")
	case "failed", "errored", "error":
		s.setStatus(doc, "failed")
	case "killed", "cancelled", "canceled", "stopped", "interrupted":
		s.setStatus(doc, "interrupted")
	}
}

func (s *claudeSubagents) finishProcess() {
	for _, doc := range s.bySpawn {
		if doc.Status == "running" {
			s.setStatus(doc, "interrupted")
		}
	}
}
