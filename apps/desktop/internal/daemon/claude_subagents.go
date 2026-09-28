package daemon

import (
	"bytes"
	"encoding/json"
	"fmt"
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
}

func newClaudeSubagents(store *Store, dataDir, sessionID string, generation int64) *claudeSubagents {
	return &claudeSubagents{codexSubagents: newCodexSubagents(store, dataDir, sessionID, ""), generation: generation, tasks: map[string]string{}, pending: map[string][][]byte{}}
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
		Content []claudeWireBlock `json:"content"`
	} `json:"message"`
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
	out := append(raw, '\n')
	if frame.Type == "user" {
		for _, block := range frame.Message.Content {
			if block.Type == "tool_result" {
				if doc := s.bySpawn[block.ToolUseID]; doc != nil {
					if block.IsError {
						s.setStatus(doc, "failed")
					} else {
						s.setStatus(doc, "done")
					}
				}
			}
		}
		return out
	}
	if frame.Type != "assistant" {
		return out
	}
	for _, block := range frame.Message.Content {
		if block.Type != "tool_use" || block.ID == "" {
			continue
		}
		if block.Name == "SendMessage" {
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
			continue
		}
		if block.Name != "Agent" && block.Name != "Task" {
			continue
		}
		doc := s.bySpawn[block.ID]
		if doc == nil {
			title, _ := block.Input["description"].(string)
			if title == "" {
				title = "Agent"
			}
			doc = &subagentDoc{ID: uuid.NewString(), SpawnID: block.ID, ChildThreadID: fmt.Sprintf("claude-tool:%d:%s", s.generation, block.ID), Title: clipSubagentText(title, 100), Status: "running"}
			if _, err := s.store.db.Exec(`INSERT INTO subagent_docs(id,session_id,generation,spawn_item_id,child_thread_id,title,status,updated_at) VALUES(?,?,?,?,?,?,?,?)`, doc.ID, s.sessionID, s.generation, doc.SpawnID, doc.ChildThreadID, doc.Title, doc.Status, encodeTime(time.Now())); err != nil {
				continue
			}
			s.bySpawn[block.ID] = doc
			if prompt, _ := block.Input["prompt"].(string); strings.TrimSpace(prompt) != "" {
				s.write(doc, map[string]any{"type": "openade.user_message", "text": clipSubagentText(prompt, 64*1024)})
			}
		}
		for _, early := range s.pending[block.ID] {
			var earlyFrame claudeWireFrame
			if json.Unmarshal(early, &earlyFrame) == nil {
				s.childLine(block.ID, early, &earlyFrame)
			}
			s.pendingLen -= len(early)
		}
		delete(s.pending, block.ID)
		marker, _ := json.Marshal(map[string]string{"type": "openade.subagent", "id": block.ID, "doc_id": doc.ID, "title": doc.Title})
		out = append(out, marker...)
		out = append(out, '\n')
	}
	return out
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
			if block.Type == "tool_use" && (block.Name == "Agent" || block.Name == "Task") {
				title, _ := block.Input["description"].(string)
				s.write(doc, map[string]any{"type": "openade.unlinked_agent", "id": block.ID, "title": clipSubagentText(title, 100), "status": "spawned"})
			}
		}
	}
	if frame.Type == "user" {
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
