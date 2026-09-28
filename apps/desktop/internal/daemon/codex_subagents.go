package daemon

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const maxSubagentOutput = 2 * 1024 * 1024
const maxPendingChildBytes = 4 * 1024 * 1024

type subagentDoc struct {
	ID, SpawnID, ChildThreadID, Title, Status string
	file                                      *os.File
	bytes                                     int64
	truncated                                 bool
}

type codexSubagents struct {
	store       *Store
	dataDir     string
	sessionID   string
	parentID    string
	bySpawn     map[string]*subagentDoc
	byThread    map[string]*subagentDoc
	pending     map[string][]providerRPCFrame
	pendingSize int
}

func newCodexSubagents(store *Store, dataDir, sessionID, parentID string) *codexSubagents {
	return &codexSubagents{store: store, dataDir: dataDir, sessionID: sessionID, parentID: parentID,
		bySpawn: map[string]*subagentDoc{}, byThread: map[string]*subagentDoc{}, pending: map[string][]providerRPCFrame{}}
}

type subagentWireItem struct {
	Type              string   `json:"type"`
	ID                string   `json:"id"`
	Tool              string   `json:"tool"`
	Status            string   `json:"status"`
	Kind              string   `json:"kind"`
	Prompt            string   `json:"prompt"`
	AgentPath         string   `json:"agentPath"`
	AgentThreadID     string   `json:"agentThreadId"`
	AgentThreadSnake  string   `json:"agent_thread_id"`
	ReceiverThreadIDs []string `json:"receiverThreadIds"`
	ReceiverSnake     []string `json:"receiver_thread_ids"`
	Text              string   `json:"text"`
	Command           string   `json:"command"`
	AggregatedOutput  string   `json:"aggregatedOutput"`
}

type subagentWireParams struct {
	ThreadID string                  `json:"threadId"`
	ItemID   string                  `json:"itemId"`
	Delta    string                  `json:"delta"`
	Turn     struct{ Status string } `json:"turn"`
	Item     subagentWireItem        `json:"item"`
}

func subagentTitle(item subagentWireItem) string {
	if item.AgentPath != "" {
		if leaf := filepath.Base(strings.TrimRight(item.AgentPath, "/")); leaf != "." && leaf != "/" && leaf != "" {
			return clipSubagentText(leaf, 100)
		}
	}
	title := strings.Join(strings.Fields(item.Prompt), " ")
	if title == "" {
		return "Subagent"
	}
	return clipSubagentText(title, 100)
}

func clipSubagentText(value string, limit int) string {
	value = strings.ToValidUTF8(value, "�")
	if len(value) <= limit {
		return value
	}
	cut := limit - len("…")
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	return strings.TrimSpace(value[:cut]) + "…"
}

// A parent item is a spawn only for spawnAgent/spawn_agent, or for the v2
// subAgentActivity marker. Controls such as sendInput and wait never own docs.
func (s *codexSubagents) parentItem(frame providerRPCFrame, generation int64, emit func(any) error) bool {
	var p subagentWireParams
	if json.Unmarshal(frame.Params, &p) != nil {
		return false
	}
	item := p.Item
	v1 := (item.Type == "collabAgentToolCall" || item.Type == "collab_agent_tool_call") && (item.Tool == "spawnAgent" || item.Tool == "spawn_agent")
	v2 := (item.Type == "subAgentActivity" || item.Type == "sub_agent_activity") && (item.Kind == "started" || item.Kind == "spawned")
	if !v1 && !v2 {
		return false
	}
	if v2 && (item.AgentPath == "/" || item.AgentPath == "/root") {
		return true
	}
	if item.ID == "" || len(item.ID) > 256 {
		return true
	}
	spawnKey := fmt.Sprintf("%d:%s", generation, item.ID)
	doc := s.bySpawn[spawnKey]
	if doc == nil {
		doc = &subagentDoc{ID: uuid.NewString(), SpawnID: item.ID, Title: subagentTitle(item), Status: "running"}
		_, err := s.store.db.Exec(`INSERT INTO subagent_docs(id,session_id,generation,spawn_item_id,title,status,updated_at) VALUES(?,?,?,?,?,?,?)`, doc.ID, s.sessionID, generation, doc.SpawnID, doc.Title, doc.Status, encodeTime(time.Now()))
		if err != nil {
			return true
		}
		s.bySpawn[spawnKey] = doc
		_ = emit(map[string]any{"type": "openade.subagent", "id": item.ID, "doc_id": doc.ID, "title": doc.Title})
	}
	if frame.Method == "item/completed" && (item.Status == "failed" || item.Status == "errored") {
		s.setStatus(doc, "failed")
		return true
	}
	child := ""
	if v2 {
		child = item.AgentThreadID
		if child == "" {
			child = item.AgentThreadSnake
		}
	} else if frame.Method == "item/completed" {
		receivers := item.ReceiverThreadIDs
		if receivers == nil {
			receivers = item.ReceiverSnake
		}
		if len(receivers) == 1 {
			child = receivers[0]
		}
	}
	if child != "" && child != s.parentID && len(child) <= 256 && (doc.ChildThreadID == "" || doc.ChildThreadID == child) {
		if owner := s.byThread[child]; owner != nil && owner != doc {
			return true
		}
		if doc.ChildThreadID == "" {
			if _, err := s.store.db.Exec(`UPDATE subagent_docs SET child_thread_id=?,updated_at=? WHERE id=? AND child_thread_id=''`, child, encodeTime(time.Now()), doc.ID); err != nil {
				return true
			}
			doc.ChildThreadID = child
			s.byThread[child] = doc
		}
		for _, pending := range s.pending[child] {
			s.record(doc, pending)
		}
		s.pendingSize -= pendingFrameBytes(s.pending[child])
		delete(s.pending, child)
	} else if v1 && frame.Method == "item/completed" && doc.ChildThreadID == "" {
		// A completed control-shaped spawn with no single receiver has no
		// child document to link. Its tool call finished, so do not leave a
		// misleading live child chip behind.
		s.setStatus(doc, "done")
	}
	return true
}

func pendingFrameBytes(frames []providerRPCFrame) int {
	total := 0
	for _, frame := range frames {
		total += len(frame.Params)
	}
	return total
}

// Child events are never passed into parent turn handling. Unbound traffic is
// buffered briefly because Codex can stream before the spawn result arrives.
func (s *codexSubagents) child(frame providerRPCFrame, threadID string) {
	if threadID == "" || threadID == s.parentID {
		return
	}
	if doc := s.byThread[threadID]; doc != nil {
		s.record(doc, frame)
		return
	}
	if len(frame.Params) <= maxPendingChildBytes && s.pendingSize+len(frame.Params) <= maxPendingChildBytes && (len(s.pending) < 32 || s.pending[threadID] != nil) {
		s.pending[threadID] = append(s.pending[threadID], frame)
		s.pendingSize += len(frame.Params)
	}
}

func (s *codexSubagents) record(doc *subagentDoc, frame providerRPCFrame) {
	var p subagentWireParams
	if json.Unmarshal(frame.Params, &p) != nil {
		return
	}
	switch frame.Method {
	case "turn/started":
		s.setStatus(doc, "running")
	case "turn/completed":
		if p.Turn.Status == "failed" || p.Turn.Status == "interrupted" {
			s.setStatus(doc, "failed")
		} else {
			s.setStatus(doc, "done")
		}
	case "turn/failed", "turn/aborted":
		s.setStatus(doc, "failed")
	case "thread/closed":
		if doc.Status == "running" {
			s.setStatus(doc, "done")
		}
	case "item/agentMessage/delta":
		s.write(doc, map[string]any{"type": "openade.agent_delta", "id": clipSubagentText(p.ItemID, 256), "text": clipSubagentText(p.Delta, 64*1024)})
	case "item/reasoning/textDelta", "item/reasoning/summaryTextDelta":
		s.write(doc, map[string]any{"type": "stream_event", "event": map[string]any{"delta": map[string]string{"type": "thinking_delta"}}})
	case "item/started", "item/completed":
		item := p.Item
		if (item.Type == "userMessage" || item.Type == "user_message") && frame.Method == "item/completed" {
			s.write(doc, map[string]any{"type": "openade.user_message", "text": clipSubagentText(item.Text, 64*1024)})
		} else if (item.Type == "agentMessage" || item.Type == "agent_message") && frame.Method == "item/completed" {
			s.write(doc, map[string]any{"type": "openade.agent_message", "id": clipSubagentText(item.ID, 256), "text": clipSubagentText(item.Text, 64*1024)})
		} else if item.Type == "commandExecution" || item.Type == "command_execution" {
			phase := "item.started"
			if frame.Method == "item/completed" {
				phase = "item.completed"
			}
			s.write(doc, map[string]any{"type": phase, "item": map[string]string{"type": "command_execution", "command": clipSubagentText(item.Command, 4096), "aggregated_output": clipSubagentText(item.AggregatedOutput, 64*1024)}})
		} else if frame.Method == "item/completed" && (item.Type == "mcpToolCall" || item.Type == "mcp_tool_call" || item.Type == "webSearch" || item.Type == "web_search" || item.Type == "collabAgentToolCall" || item.Type == "collab_agent_tool_call") {
			s.write(doc, map[string]any{"type": "openade.tool", "id": clipSubagentText(item.ID, 256), "title": clipSubagentText(item.Type, 100), "detail": clipSubagentText(item.Status, 100)})
		}
	case "error":
		s.write(doc, map[string]any{"type": "error", "message": "Subagent reported a provider error."})
	}
}

func (s *codexSubagents) path(doc *subagentDoc) string {
	return filepath.Join(s.dataDir, "subagents", s.sessionID, doc.ID+".log")
}

func (s *codexSubagents) write(doc *subagentDoc, event any) {
	if doc.truncated {
		return
	}
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	data = append(data, '\n')
	if doc.bytes+int64(len(data)) > maxSubagentOutput-256 {
		if !doc.truncated {
			doc.truncated = true
			notice, _ := json.Marshal(map[string]string{"type": "error", "message": "Subagent transcript is truncated after 2 MiB."})
			s.writeBytes(doc, append(notice, '\n'), maxSubagentOutput)
		}
		return
	}
	s.writeBytes(doc, data, maxSubagentOutput-256)
}

func (s *codexSubagents) writeBytes(doc *subagentDoc, data []byte, limit int64) {
	if doc.bytes+int64(len(data)) > limit {
		return
	}
	if doc.file == nil {
		if os.MkdirAll(filepath.Dir(s.path(doc)), 0700) != nil {
			return
		}
		file, openErr := os.OpenFile(s.path(doc), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if openErr != nil {
			return
		}
		doc.file = file
		if info, statErr := file.Stat(); statErr == nil {
			doc.bytes = info.Size()
		}
	}
	if doc.bytes+int64(len(data)) > limit {
		return
	}
	n, writeErr := doc.file.Write(data)
	doc.bytes += int64(n)
	if writeErr != nil || n != len(data) {
		doc.truncated = true
		_ = doc.file.Close()
		doc.file = nil
	}
}

func (s *codexSubagents) setStatus(doc *subagentDoc, status string) {
	if doc.Status == status {
		return
	}
	if _, err := s.store.db.Exec(`UPDATE subagent_docs SET status=?,updated_at=? WHERE id=?`, status, encodeTime(time.Now()), doc.ID); err != nil {
		return
	}
	doc.Status = status
	if status != "running" && doc.file != nil {
		_ = doc.file.Close()
		doc.file = nil
	}
}

func (s *codexSubagents) running() bool {
	for _, doc := range s.bySpawn {
		if doc.Status == "running" {
			return true
		}
	}
	return false
}

func (s *codexSubagents) finishParent() {
	for _, doc := range s.bySpawn {
		if doc.Status == "running" && doc.ChildThreadID == "" {
			s.setStatus(doc, "interrupted")
		}
	}
}

func (s *codexSubagents) shutdown() {
	for _, doc := range s.bySpawn {
		if doc.Status == "running" {
			s.setStatus(doc, "interrupted")
		}
		if doc.file != nil {
			_ = doc.file.Close()
			doc.file = nil
		}
	}
}

func (d *Daemon) handleListSubagents(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Query().Get("ids"), ",")
	if len(parts) == 0 || len(parts) > 128 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("choose 1 to 128 subagents"))
		return
	}
	args := []any{r.PathValue("id")}
	placeholders := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, id := range parts {
		if _, err := uuid.Parse(id); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid subagent id"))
			return
		}
		if !seen[id] {
			seen[id] = true
			args = append(args, id)
			placeholders = append(placeholders, "?")
		}
	}
	rows, err := d.store.db.Query(`SELECT id,spawn_item_id,child_thread_id,title,status FROM subagent_docs WHERE session_id=? AND id IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	defer rows.Close()
	items := []map[string]string{}
	for rows.Next() {
		var id, spawn, child, title, status string
		if err := rows.Scan(&id, &spawn, &child, &title, &status); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		items = append(items, map[string]string{"id": id, "spawn_item_id": spawn, "child_thread_id": child, "title": title, "status": status})
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"subagents": items})
}

func (d *Daemon) handleGetSubagent(w http.ResponseWriter, r *http.Request) {
	id, sessionID := r.PathValue("docID"), r.PathValue("id")
	after, cursorErr := streamCursor(r)
	if cursorErr != nil {
		writeError(w, http.StatusBadRequest, cursorErr)
		return
	}
	if _, err := uuid.Parse(id); err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("subagent not found"))
		return
	}
	var doc subagentDoc
	err := d.store.db.QueryRow(`SELECT id,spawn_item_id,child_thread_id,title,status FROM subagent_docs WHERE id=? AND session_id=?`, id, sessionID).Scan(&doc.ID, &doc.SpawnID, &doc.ChildThreadID, &doc.Title, &doc.Status)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("subagent not found"))
		return
	}
	path := filepath.Join(d.config.DataDir, "subagents", sessionID, id+".log")
	output := ""
	cursor, reset := int64(0), after > 0
	if info, statErr := os.Lstat(path); statErr == nil {
		if !info.Mode().IsRegular() || info.Size() > maxSubagentOutput {
			writeError(w, http.StatusInternalServerError, fmt.Errorf("subagent transcript is unavailable"))
			return
		}
		replay, readErr := readReplay(path, after)
		if readErr != nil {
			writeError(w, http.StatusInternalServerError, fmt.Errorf("subagent transcript is unavailable"))
			return
		}
		// The writer appends one JSONL event per call. Never advance a cursor
		// across a partially visible line or split a UTF-8 rune in a poll.
		if last := bytes.LastIndexByte(replay.Data, '\n'); last >= 0 {
			replay.Data = replay.Data[:last+1]
		} else {
			replay.Data = nil
		}
		output, cursor, reset = string(replay.Data), replay.Offset+int64(len(replay.Data)), replay.Reset
	} else if !os.IsNotExist(statErr) {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("subagent transcript is unavailable"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": doc.ID, "spawn_item_id": doc.SpawnID, "child_thread_id": doc.ChildThreadID, "title": doc.Title, "status": doc.Status, "output": output, "cursor": cursor, "reset": reset})
}
