package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const codexIdleTimeout = 2 * time.Minute
const maxCodexClients = 8

var codexVersionPattern = regexp.MustCompile(`^codex(?:-cli)?\s+(\d+)\.(\d+)\.`)
var codexVersionCache = struct {
	sync.Mutex
	values map[string]bool
}{values: map[string]bool{}}

type boundedVersionWriter struct{ data []byte }

func (w *boundedVersionWriter) Write(p []byte) (int, error) {
	if len(w.data)+len(p) > 4096 {
		return 0, fmt.Errorf("version output exceeded its limit")
	}
	w.data = append(w.data, p...)
	return len(p), nil
}
func supportsCodexServer(program string) bool {
	info, err := os.Stat(program)
	if err != nil {
		return false
	}
	key := program + "|" + strconv.FormatInt(info.ModTime().UnixNano(), 10) + "|" + strconv.FormatInt(info.Size(), 10)
	codexVersionCache.Lock()
	defer codexVersionCache.Unlock()
	if value, ok := codexVersionCache.values[key]; ok {
		return value
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, program, "--version")
	cmd.Env = processEnvironment()
	var output boundedVersionWriter
	cmd.Stdout = &output
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 100 * time.Millisecond
	err = cmd.Run()
	match := codexVersionPattern.FindStringSubmatch(strings.TrimSpace(string(output.data)))
	supported := false
	if err == nil && len(match) == 3 {
		major, _ := strconv.Atoi(match[1])
		minor, _ := strconv.Atoi(match[2])
		supported = major == 0 && minor >= 156
	}
	if len(codexVersionCache.values) > 32 {
		codexVersionCache.values = map[string]bool{}
	}
	codexVersionCache.values[key] = supported
	return supported
}

type ProviderQuestion struct {
	ID          string           `json:"id"`
	Header      string           `json:"header"`
	Question    string           `json:"question"`
	MultiSelect bool             `json:"multiSelect,omitempty"`
	IsOther     bool             `json:"isOther"`
	IsSecret    bool             `json:"isSecret"`
	Options     []ProviderOption `json:"options"`
}
type ProviderOption struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}
type ProviderRequest struct {
	ID         string             `json:"id"`
	Generation int64              `json:"generation"`
	Kind       string             `json:"kind"`
	Title      string             `json:"title"`
	Detail     string             `json:"detail"`
	Questions  []ProviderQuestion `json:"questions"`
	Decisions  []string           `json:"decisions"`
	wireID     json.RawMessage
	method     string
	order      uint64
}
type ProviderContext struct {
	Tokens *uint64 `json:"tokens"`
	Window *uint64 `json:"window"`
}
type ProviderState struct {
	Connected bool              `json:"connected"`
	Steering  bool              `json:"steering"`
	Requests  []ProviderRequest `json:"requests"`
	Context   ProviderContext   `json:"context"`
}
type codexSteering struct {
	live     *liveSession
	frames   []providerRPCFrame
	bytes    int
	overflow bool
	done     chan struct{}
}

type codexConversation struct {
	mu                  sync.Mutex
	manager             *SessionManager
	sessionID, threadID string
	rpc                 *providerRPC
	live                *liveSession
	providerTurn        string
	transcript          *os.File
	requests            map[string]*ProviderRequest
	subagents           *codexSubagents
	context             ProviderContext
	idle                *time.Timer
	closed              bool
	nextRequest         uint64
	steering            *codexSteering
	startDone           chan struct{}
	completedStatus     string
	processedSequence   uint64
	progress            chan struct{}
}

func (m *SessionManager) codexClient(id string) *codexConversation {
	m.providerMu.Lock()
	defer m.providerMu.Unlock()
	return m.codex[id]
}
func (m *SessionManager) closeCodex(id string) {
	if c := m.codexClient(id); c != nil {
		c.close()
	}
}
func (c *codexConversation) close() {
	c.mu.Lock()
	if !c.closed {
		c.closed = true
		if c.idle != nil {
			c.idle.Stop()
		}
		c.subagents.shutdown()
		c.rpc.stop()
	}
	c.mu.Unlock()
}
func (m *SessionManager) providerState(id string) ProviderState {
	state := ProviderState{Requests: []ProviderRequest{}}
	var saved string
	if m.store.db.QueryRow(`SELECT state FROM provider_context WHERE session_id=?`, id).Scan(&saved) == nil {
		_ = json.Unmarshal([]byte(saved), &state.Context)
	}
	if c := m.codexClient(id); c != nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		state.Connected = !c.closed
		state.Steering = !c.closed && c.live != nil && c.providerTurn != "" && len(c.requests) == 0 && c.startDone == nil && c.steering == nil
		if c.context.Tokens != nil || c.context.Window != nil {
			state.Context = c.context
		}
		for _, q := range c.requests {
			state.Requests = append(state.Requests, *q)
		}
	}
	if c := m.acpClient(id); c != nil {
		c.mu.Lock()
		state.Connected = !c.closed
		if c.context.Tokens != nil || c.context.Window != nil {
			state.Context = c.context
		}
		for _, q := range c.requests {
			state.Requests = append(state.Requests, *q)
		}
		c.mu.Unlock()
	}
	if c := m.cursorClient(id); c != nil {
		c.mu.Lock()
		state.Connected = !c.closed
		c.mu.Unlock()
	}
	if c := m.claudeClient(id); c != nil {
		state.Connected = true
		state.Requests = append(state.Requests, c.providerRequests()...)
	}
	sort.Slice(state.Requests, func(i, j int) bool { return state.Requests[i].order < state.Requests[j].order })
	return state
}
func (m *SessionManager) startCodexTurn(session Session, program string) error {
	input, err := m.codexInput(session.Prompt)
	if err != nil {
		return err
	}
	c := m.codexClient(session.ID)
	if c != nil {
		c.mu.Lock()
		closed := c.closed
		c.mu.Unlock()
		if closed {
			c = nil
		}
	}
	if c == nil {
		// Evict only idle clients; never silently stop another running chat.
		m.providerMu.Lock()
		var evict *codexConversation
		if len(m.codex) >= maxCodexClients {
			for _, candidate := range m.codex {
				candidate.mu.Lock()
				idle := candidate.live == nil
				candidate.mu.Unlock()
				if idle {
					evict = candidate
					break
				}
			}
		}
		m.providerMu.Unlock()
		if evict != nil {
			evict.close()
			// Keep the client discoverable by deletion until its subprocess has
			// actually exited, including when capacity eviction chooses it.
			select {
			case <-evict.rpc.processDone:
				m.providerMu.Lock()
				if m.codex[evict.sessionID] == evict {
					delete(m.codex, evict.sessionID)
				}
				m.providerMu.Unlock()
			case <-time.After(4 * time.Second):
				return fmt.Errorf("Codex client did not stop in time")
			}
		}
		m.providerMu.Lock()
		full := len(m.codex) >= maxCodexClients
		m.providerMu.Unlock()
		if full {
			return fmt.Errorf("eight Codex chats are active; stop one before starting another")
		}
		rpc, err := startProviderRPC(program, []string{"app-server"}, session, false)
		if err != nil {
			return fmt.Errorf("start Codex app server: %w", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err = rpc.request(ctx, "initialize", map[string]any{"clientInfo": map[string]string{"name": "openade", "title": "OpenADE", "version": "0.4.0"}, "capabilities": map[string]bool{"experimentalApi": true}})
		if err == nil {
			err = rpc.notify(ctx, "initialized", map[string]any{})
		}
		if err != nil {
			rpc.stop()
			return fmt.Errorf("Codex initialization failed")
		}
		params := map[string]any{"cwd": session.WorktreePath, "sandbox": "workspace-write", "approvalPolicy": "on-request", "approvalsReviewer": "user"}
		if session.Model != "" {
			params["model"] = session.Model
		}
		if session.ServiceTier != "" {
			params["serviceTier"] = session.ServiceTier
		}
		method := "thread/start"
		if id := m.providerID(session); id != "" {
			method = "thread/resume"
			params["threadId"] = id
		}
		data, err := rpc.request(ctx, method, params)
		var result struct {
			Thread struct {
				ID string `json:"id"`
			} `json:"thread"`
		}
		if err == nil {
			err = json.Unmarshal(data, &result)
		}
		if err != nil || result.Thread.ID == "" {
			rpc.stop()
			return fmt.Errorf("Codex could not open the conversation")
		}
		if err = m.writeProviderSessionMarker(session, result.Thread.ID); err != nil {
			rpc.stop()
			return err
		}
		c = &codexConversation{manager: m, sessionID: session.ID, threadID: result.Thread.ID, rpc: rpc, requests: map[string]*ProviderRequest{}, subagents: newCodexSubagents(m.store, m.dataDir, session.ID, result.Thread.ID), progress: make(chan struct{})}
		m.providerMu.Lock()
		m.codex[session.ID] = c
		c.idle = time.AfterFunc(codexIdleTimeout, c.close)
		m.providerMu.Unlock()
		go c.events()
	}
	var startTree string
	if session.Branch != "" {
		startTree, _ = snapshotWorkingTree(context.Background(), session.WorktreePath)
	}
	turnID, generation, err := m.store.BeginCodexTurn(session.ID, session.Prompt, session.queueMessageID, startTree)
	if err != nil {
		return err
	}
	transcript, err := os.OpenFile(filepath.Join(m.dataDir, "transcripts", session.ID+".log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		_ = m.store.updateGeneration(session.ID, generation, "failed", 0, nil)
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return err
	}
	live := newLiveSession(nil, c.rpc.cmd)
	live.rawPTY = false
	live.forkBootstrap = session.forkBootstrap
	live.generation = generation
	live.turnID = turnID
	live.codex = c
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		transcript.Close()
		_ = m.store.updateGeneration(session.ID, generation, "failed", 0, nil)
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return fmt.Errorf("Codex disconnected; retry your message")
	}
	if c.idle != nil {
		c.idle.Stop()
		c.idle = nil
	}
	c.live = live
	startDone := make(chan struct{})
	c.startDone = startDone
	c.completedStatus = ""
	c.providerTurn = ""
	c.transcript = transcript
	c.requests = map[string]*ProviderRequest{}
	m.mu.Lock()
	m.live[session.ID] = live
	m.mu.Unlock()
	if err := m.store.updateGeneration(session.ID, generation, "running", c.rpc.cmd.Process.Pid, nil); err != nil {
		c.finish("failed")
		c.startDone = nil
		close(startDone)
		c.mu.Unlock()
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return fmt.Errorf("unable to record provider turn ownership")
	}
	c.emit(map[string]any{"type": "turn.started"})
	c.mu.Unlock()
	params := map[string]any{"threadId": c.threadID, "input": input, "cwd": session.WorktreePath, "approvalPolicy": "on-request", "approvalsReviewer": "user", "sandboxPolicy": map[string]any{"type": "workspaceWrite", "writableRoots": []string{session.WorktreePath}, "networkAccess": false}}
	if session.Instructions != "" {
		params["additionalContext"] = map[string]any{"openade-chat-instructions": map[string]string{"kind": "application", "value": session.Instructions}}
	}
	if session.Model != "" {
		params["model"] = session.Model
	}
	if session.Effort != "" {
		params["effort"] = session.Effort
	}
	if session.ServiceTier != "" {
		params["serviceTier"] = session.ServiceTier
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	data, through, err := c.rpc.requestWithSequence(ctx, "turn/start", params)
	if err == nil {
		err = c.waitThrough(ctx, through)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	defer func() { c.startDone = nil; close(startDone) }()
	if err != nil {
		// A lost acknowledgement may already have started work. Never silently
		// fall back to exec or retry the same queued prompt.
		c.emit(map[string]any{"type": "error", "message": "Codex did not acknowledge the turn. It may have started; check the conversation before retrying."})
		c.rpc.stop()
		c.closed = true
		c.finish("failed")
		if session.queueMessageID != "" {
			_, _ = m.store.db.Exec(`UPDATE message_queue SET status='uncertain' WHERE id=?`, session.queueMessageID)
		}
		return err
	}
	var result struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if c.closed || c.live != live || json.Unmarshal(data, &result) != nil || result.Turn.ID == "" || (c.live == live && c.providerTurn != "" && c.providerTurn != result.Turn.ID) {
		c.emit(map[string]any{"type": "error", "message": "Codex returned an invalid turn acknowledgement."})
		c.rpc.stop()
		c.closed = true
		c.finish("failed")
		if session.queueMessageID != "" {
			_, _ = m.store.db.Exec(`UPDATE message_queue SET status='uncertain' WHERE id=?`, session.queueMessageID)
		}
		return fmt.Errorf("invalid Codex turn acknowledgement")
	}
	if c.live == live && c.providerTurn == "" {
		c.providerTurn = result.Turn.ID
	}
	if live.forkBootstrap {
		if err := m.store.markForkContextDelivered(session.ID, c.threadID); err != nil {
			c.emit(map[string]any{"type": "error", "message": "Unable to save side-chat history delivery; the next turn may repeat its context."})
		}
	}
	if c.completedStatus != "" {
		c.finish(c.completedStatus)
	}
	return nil
}
func (m *SessionManager) codexInput(prompt string) ([]map[string]any, error) {
	const marker = "\n\nAttached images (local files — open them to view):\n"
	input := []map[string]any{}
	text := prompt
	if at := strings.LastIndex(prompt, marker); at >= 0 {
		folder := filepath.Join(m.dataDir, "attachments")
		lines := strings.Split(prompt[at+len(marker):], "\n")
		if len(lines) > 32 {
			return nil, fmt.Errorf("too many attached images")
		}
		for _, line := range lines {
			imagePath := strings.TrimPrefix(line, "- ")
			name := filepath.Base(imagePath)
			id := strings.TrimSuffix(name, filepath.Ext(name))
			if _, err := uuid.Parse(id); err != nil || !strings.HasPrefix(line, "- ") || filepath.Dir(imagePath) != folder {
				return nil, fmt.Errorf("attachment does not belong to this profile")
			}
			data, err := os.ReadFile(filepath.Join(folder, id+".json"))
			var attachment Attachment
			if err != nil || json.Unmarshal(data, &attachment) != nil || attachment.ID != id || attachment.Path != imagePath {
				return nil, fmt.Errorf("attachment is unavailable")
			}
			info, err := os.Lstat(imagePath)
			if err != nil || !info.Mode().IsRegular() {
				return nil, fmt.Errorf("attachment is unavailable")
			}
			input = append(input, map[string]any{"type": "localImage", "path": imagePath})
		}
		text = prompt[:at]
	}
	return append([]map[string]any{{"type": "text", "text": text, "text_elements": []any{}}}, input...), nil
}

// All emit/finish/handle calls hold c.mu. Only normalized presentation events
// reach transcripts; request answers and raw provider configuration never do.
func (c *codexConversation) emit(event any) error {
	if c.live == nil {
		return fmt.Errorf("no active turn")
	}
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	live := c.live
	live.mu.Lock()
	defer live.mu.Unlock()
	if c.transcript != nil {
		if _, err := c.transcript.Write(data); err != nil {
			return err
		}
	}
	live.scrollback = append(live.scrollback, data...)
	if len(live.scrollback) > 256*1024 {
		live.scrollback = append([]byte(nil), live.scrollback[len(live.scrollback)-128*1024:]...)
	}
	for ch := range live.subscribers {
		select {
		case ch <- data:
		default:
			delete(live.subscribers, ch)
			close(ch)
		}
	}
	return nil
}

// A question's transcript marker is presentation-only. The prompt and answers
// can contain secrets, so retain only the validated short header and state.
func (c *codexConversation) emitQuestionMarker(q *ProviderRequest, status string) {
	if q.Kind != "question" || len(q.Questions) == 0 {
		return
	}
	header := strings.TrimSpace(q.Questions[0].Header)
	if header == "" {
		header = "Question"
	}
	_ = c.emit(map[string]any{"type": "openade.question", "id": q.ID, "header": header, "status": status})
}

func (c *codexConversation) finish(status string) {
	live := c.live
	if live == nil {
		return
	}
	live.mu.Lock()
	if live.stopRequested {
		status = live.terminationReason
	}
	live.mu.Unlock()
	code := 0
	if status == "failed" {
		code = 1
	}
	_ = c.manager.store.updateGeneration(c.sessionID, live.generation, status, 0, &code)
	if status == "completed" && live.forkBootstrap {
		_ = c.manager.store.markForkContextDelivered(c.sessionID, c.threadID)
	}
	c.manager.mu.Lock()
	if c.manager.live[c.sessionID] == live {
		delete(c.manager.live, c.sessionID)
	}
	c.manager.mu.Unlock()
	for _, q := range c.requests {
		c.emitQuestionMarker(q, "dismissed")
	}
	if c.transcript != nil {
		c.transcript.Close()
		c.transcript = nil
	}
	c.requests = map[string]*ProviderRequest{}
	c.subagents.finishParent()
	c.live = nil
	c.providerTurn = ""
	live.mu.Lock()
	for ch := range live.subscribers {
		close(ch)
	}
	live.subscribers = map[chan []byte]struct{}{}
	live.mu.Unlock()
	close(live.readDone)
	close(live.done)
	if !c.closed && !c.subagents.running() {
		c.idle = time.AfterFunc(codexIdleTimeout, c.close)
	}
	if status == "completed" {
		c.manager.maybeGenerateTitle(c.sessionID, live.generation)
		go func() { _ = c.manager.DrainQueue(c.sessionID) }()
	}
}

// A response still bypasses the event consumer, but admitting its turn waits
// for notifications received before that response to settle identity first.
func (c *codexConversation) waitThrough(ctx context.Context, sequence uint64) error {
	for {
		c.mu.Lock()
		if c.closed {
			c.mu.Unlock()
			return fmt.Errorf("provider closed before acknowledgement validation")
		}
		if c.processedSequence >= sequence {
			c.mu.Unlock()
			return nil
		}
		progress := c.progress
		c.mu.Unlock()
		select {
		case <-progress:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (c *codexConversation) events() {
	for frame := range c.rpc.events {
		c.rpc.consume(frame)
		c.mu.Lock()
		c.handle(frame)
		c.processedSequence = frame.sequence
		close(c.progress)
		c.progress = make(chan struct{})
		c.mu.Unlock()
	}
	c.rpc.stop()
	c.mu.Lock()
	pending := c.steering
	start := c.startDone
	c.mu.Unlock()
	if start != nil {
		<-start
	}
	if pending != nil {
		<-pending.done
	}
	c.mu.Lock()
	c.closed = true
	c.subagents.shutdown()
	if c.idle != nil {
		c.idle.Stop()
	}
	if c.live != nil {
		c.emit(map[string]any{"type": "error", "message": "Codex connection closed before this turn completed."})
		c.finish("failed")
	}
	c.mu.Unlock()
	c.manager.providerMu.Lock()
	if c.manager.codex[c.sessionID] == c {
		delete(c.manager.codex, c.sessionID)
	}
	c.manager.providerMu.Unlock()
}
func (c *codexConversation) handle(frame providerRPCFrame) {
	var p struct {
		ItemID    string                      `json:"itemId"`
		ThreadID  string                      `json:"threadId"`
		TurnID    string                      `json:"turnId"`
		RequestID json.RawMessage             `json:"requestId"`
		Turn      struct{ ID, Status string } `json:"turn"`
		Delta     string                      `json:"delta"`
		Item      struct {
			Type, ID, Text, Command, AggregatedOutput, Status, Tool string
			SavedPath                                               string          `json:"savedPath"`
			SavedPathSnake                                          string          `json:"saved_path"`
			Failure                                                 json.RawMessage `json:"failure"`
		} `json:"item"`
		TokenUsage struct {
			Last               struct{ TotalTokens, InputTokens, OutputTokens *uint64 }
			ModelContextWindow *uint64
		} `json:"tokenUsage"`
		Questions                             []ProviderQuestion `json:"questions"`
		Command, Reason, GrantRoot, Cwd, Kind string
		NetworkApprovalContext                json.RawMessage   `json:"networkApprovalContext"`
		AdditionalPermissions                 json.RawMessage   `json:"additionalPermissions"`
		EnvironmentID                         string            `json:"environmentId"`
		AvailableDecisions                    []json.RawMessage `json:"availableDecisions"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if json.Unmarshal(frame.Params, &p) != nil {
		if len(frame.ID) > 0 {
			_ = c.rpc.reject(ctx, frame.ID, -32602, "Invalid request")
		}
		return
	}
	// Child completion/request ownership can never settle/approve the parent.
	if p.ThreadID != "" && p.ThreadID != c.threadID {
		if c.closed {
			return
		}
		if len(frame.ID) > 0 {
			_ = c.rpc.reject(ctx, frame.ID, -32601, "Child-thread requests are not supported")
		} else if c.subagents != nil {
			c.subagents.child(frame, p.ThreadID)
			if c.live == nil && c.subagents.running() && c.idle != nil {
				c.idle.Stop()
				c.idle = nil
			} else if c.live == nil && !c.subagents.running() && c.idle == nil {
				c.idle = time.AfterFunc(codexIdleTimeout, c.close)
			}
		}
		return
	}
	if frame.Method == "serverRequest/resolved" {
		for key, q := range c.requests {
			if string(q.wireID) == string(p.RequestID) {
				c.emitQuestionMarker(q, "dismissed")
				delete(c.requests, key)
			}
		}
		c.waitingState()
		return
	}
	if c.live == nil {
		if len(frame.ID) > 0 {
			_ = c.rpc.reject(ctx, frame.ID, -32600, "No active turn")
		}
		return
	}
	if p.TurnID != "" && c.providerTurn != "" && p.TurnID != c.providerTurn {
		if len(frame.ID) > 0 {
			_ = c.rpc.reject(ctx, frame.ID, -32600, "Stale turn")
		}
		return
	}
	if len(frame.ID) > 0 {
		if p.ThreadID != c.threadID || p.TurnID == "" {
			_ = c.rpc.reject(ctx, frame.ID, -32600, "Missing request ownership")
			return
		}
		if c.providerTurn == "" {
			c.providerTurn = p.TurnID
		}
		for _, existing := range c.requests {
			if string(existing.wireID) == string(frame.ID) {
				return
			}
		}
		if len(frame.ID) > 256 {
			_ = c.rpc.reject(ctx, frame.ID, -32602, "Request ID exceeded its limit")
			return
		}
		if len(c.requests) >= 8 {
			_ = c.rpc.reject(ctx, frame.ID, -32600, "Too many pending questions")
			return
		}
		c.nextRequest++
		q := &ProviderRequest{order: c.nextRequest, ID: uuid.NewString(), Generation: c.live.generation, wireID: append(json.RawMessage(nil), frame.ID...), method: frame.Method, Questions: []ProviderQuestion{}, Decisions: []string{}}
		switch frame.Method {
		case "item/tool/requestUserInput":
			q.Kind = "question"
			q.Title = "Your input is needed"
			q.Questions = p.Questions
			if !validProviderQuestions(q.Questions) {
				_ = c.rpc.reject(ctx, frame.ID, -32602, "Invalid questions")
				return
			}
		case "item/commandExecution/requestApproval":
			// These variants authorize different actions than a displayed shell command.
			// Never offer acceptance until their complete scope has a dedicated UI.
			present := func(v json.RawMessage) bool { return len(v) > 0 && string(v) != "null" }
			if strings.TrimSpace(p.Command) == "" || strings.TrimSpace(p.Cwd) == "" || (p.Kind != "" && p.Kind != "command") || present(p.NetworkApprovalContext) || present(p.AdditionalPermissions) || p.EnvironmentID != "" {
				_ = c.rpc.reject(ctx, frame.ID, -32601, "This approval scope is not supported")
				c.emit(map[string]any{"type": "error", "message": "Codex requested an unsupported approval scope; nothing was approved."})
				return
			}
			q.Kind = "approval"
			q.Title = "Allow this command?"
			q.Detail = p.Command + "\nWorking directory: " + p.Cwd
			if p.Reason != "" {
				q.Detail += "\n" + p.Reason
			}
			q.Decisions = []string{"accept", "decline", "cancel"}
			if len(p.AvailableDecisions) > 0 {
				q.Decisions = nil
				for _, raw := range p.AvailableDecisions {
					var decision string
					_ = json.Unmarshal(raw, &decision)
					if decision == "accept" || decision == "decline" || decision == "cancel" {
						q.Decisions = append(q.Decisions, decision)
					}
				}
			}
		case "item/fileChange/requestApproval":
			// Reason is explanatory text, not the proposed paths and patch. A
			// session-wide grant is also broader than the UI's Allow once promise.
			_ = c.rpc.reject(ctx, frame.ID, -32601, "File approval requires complete patch presentation")
			c.emit(map[string]any{"type": "error", "message": "This file approval cannot show its complete patch yet; nothing was approved."})
			return
		case "item/permissions/requestApproval":
			_ = c.rpc.respond(ctx, frame.ID, map[string]any{"permissions": map[string]any{}, "scope": "turn"})
			c.emit(map[string]any{"type": "error", "message": "Additional permission requests are not supported yet; no permissions were granted."})
			return
		default:
			_ = c.rpc.reject(ctx, frame.ID, -32601, "This provider request is not supported")
			c.emit(map[string]any{"type": "error", "message": "Codex requested an unsupported interaction; it was not approved."})
			return
		}
		if len(q.Detail) > 32768 {
			_ = c.rpc.reject(ctx, frame.ID, -32602, "Approval detail exceeded its display limit")
			return
		}
		if len(q.Decisions) == 0 && q.Kind == "approval" {
			_ = c.rpc.reject(ctx, frame.ID, -32601, "Unsupported approval decisions")
			return
		}
		encoded, _ := json.Marshal(q)
		retained := len(encoded)
		for _, existing := range c.requests {
			old, _ := json.Marshal(existing)
			retained += len(old)
		}
		if len(encoded) > 256*1024 || retained > 1024*1024 {
			_ = c.rpc.reject(ctx, frame.ID, -32602, "Questions exceeded their limit")
			return
		}
		c.requests[q.ID] = q
		c.emitQuestionMarker(q, "pending")
		c.waitingState()
		return
	}

	if pending := c.steering; pending != nil && pending.live == c.live {
		switch frame.Method {
		case "item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta", "item/started", "item/completed", "thread/tokenUsage/updated", "turn/completed", "error":
			if frame.Method == "turn/completed" && p.Turn.ID != c.providerTurn {
				return
			}
			size := len(frame.Params) + len(frame.Method)
			if len(pending.frames) >= 256 || pending.bytes+size > 1024*1024 {
				pending.overflow = true
				c.rpc.stop()
				return
			}
			pending.frames = append(pending.frames, frame)
			pending.bytes += size
			return
		}
	}
	switch frame.Method {
	case "turn/started":
		if p.Turn.ID != "" && c.providerTurn != "" && c.providerTurn != p.Turn.ID {
			c.emit(map[string]any{"type": "error", "message": "Codex turn identity did not match its acknowledgement."})
			c.rpc.stop()
			c.closed = true
			c.finish("failed")
			return
		}
		if p.Turn.ID != "" && c.providerTurn == "" {
			c.providerTurn = p.Turn.ID
		}
	case "item/agentMessage/delta":
		c.emit(map[string]any{"type": "openade.agent_delta", "id": p.ItemID, "text": p.Delta})
	case "item/reasoning/textDelta", "item/reasoning/summaryTextDelta":
		c.emit(map[string]any{"type": "stream_event", "event": map[string]any{"delta": map[string]string{"type": "thinking_delta"}}})
	case "item/started", "item/completed":
		if c.subagents != nil && c.subagents.parentItem(frame, c.live.generation, c.emit) {
			return
		}
		phase := "item.started"
		if frame.Method == "item/completed" {
			phase = "item.completed"
		}
		switch p.Item.Type {
		case "imageGeneration", "image_generation":
			if p.TurnID == "" || p.TurnID != c.providerTurn || p.Item.ID == "" || len(p.Item.ID) > 256 {
				return
			}
			if phase == "item.started" {
				c.emit(map[string]any{"type": "openade.tool", "id": p.Item.ID, "title": "Generate image", "detail": "Generating image…"})
				return
			}
			failed := p.Item.Status == "failed" || p.Item.Status == "cancelled" || p.Item.Status == "canceled" || (len(p.Item.Failure) > 0 && string(p.Item.Failure) != "null")
			path := p.Item.SavedPath
			if path == "" {
				path = p.Item.SavedPathSnake
			}
			if failed || path == "" {
				c.emit(map[string]any{"type": "openade.tool", "id": p.Item.ID, "title": "Generate image", "detail": "Image unavailable"})
				c.emit(map[string]any{"type": "error", "message": "Generated image unavailable"})
				return
			}
			image, imageErr := c.manager.importGeneratedImage(c.sessionID, p.Item.ID, path)
			if imageErr != nil {
				c.emit(map[string]any{"type": "openade.tool", "id": p.Item.ID, "title": "Generate image", "detail": "Image unavailable"})
				c.emit(map[string]any{"type": "error", "message": "Generated image unavailable"})
				return
			}
			c.emit(map[string]any{"type": "openade.tool", "id": p.Item.ID, "title": "Generate image", "detail": "Image ready"})
			c.emit(map[string]any{"type": "openade.generated_image", "id": image.ID, "name": image.Name, "mime": image.MIME, "size": image.Size})
		case "agentMessage":
			if phase == "item.completed" {
				c.emit(map[string]any{"type": "openade.agent_message", "id": p.Item.ID, "text": p.Item.Text})
			}
		case "commandExecution":
			c.emit(map[string]any{"type": phase, "item": map[string]string{"type": "command_execution", "command": p.Item.Command, "aggregated_output": p.Item.AggregatedOutput}})
		case "fileChange":
			c.emit(map[string]any{"type": "openade.tool", "title": "Changed files", "detail": p.Item.Status})
		case "mcpToolCall", "webSearch":
			title := "MCP tool"
			if p.Item.Type == "webSearch" {
				title = "Web search"
			}
			c.emit(map[string]any{"type": "openade.tool", "id": p.Item.ID, "title": title, "detail": p.Item.Status})
		case "collabAgentToolCall", "collab_agent_tool_call":
			c.emit(map[string]any{"type": "openade.tool", "id": p.Item.ID, "title": subagentControlTitle(p.Item.Tool), "detail": p.Item.Status})
		}
	case "thread/tokenUsage/updated":
		tokens := p.TokenUsage.Last.TotalTokens
		if tokens == nil && p.TokenUsage.Last.InputTokens != nil {
			n := *p.TokenUsage.Last.InputTokens
			if p.TokenUsage.Last.OutputTokens != nil {
				n += *p.TokenUsage.Last.OutputTokens
			}
			tokens = &n
		}
		window := p.TokenUsage.ModelContextWindow
		if window != nil && *window == 0 {
			window = nil
		}
		c.context = ProviderContext{Tokens: tokens, Window: window}
		encoded, _ := json.Marshal(c.context)
		_, _ = c.manager.store.db.Exec(`INSERT INTO provider_context(session_id,state) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state`, c.sessionID, string(encoded))
	case "turn/completed":
		if p.Turn.ID == "" || c.providerTurn == "" || p.Turn.ID != c.providerTurn {
			return
		}
		status := "completed"
		if p.Turn.Status == "failed" {
			status = "failed"
			c.emit(map[string]any{"type": "error", "message": "Codex failed to complete the turn."})
		}
		if p.Turn.Status == "interrupted" {
			status = "interrupted"
		}
		c.emit(map[string]any{"type": "turn.completed", "created_at": encodeTime(time.Now().UTC())})
		if c.startDone != nil {
			c.completedStatus = status
			return
		}
		c.finish(status)
	case "error":
		c.emit(map[string]any{"type": "error", "message": "Codex reported a provider error."})
	}
}
func validProviderQuestions(questions []ProviderQuestion) bool {
	if len(questions) == 0 || len(questions) > 12 {
		return false
	}
	ids := map[string]bool{}
	for _, q := range questions {
		if q.ID == "" || ids[q.ID] || len(q.ID) > 256 || len(q.Header) > 256 || len(q.Question) > 32768 || len(q.Options) > 12 {
			return false
		}
		ids[q.ID] = true
		for _, o := range q.Options {
			if o.Label == "" || len(o.Label) > 4096 || len(o.Description) > 16384 {
				return false
			}
		}
	}
	return true
}
func (c *codexConversation) waitingState() {
	if c.live == nil {
		return
	}
	status := "running"
	if len(c.requests) > 0 {
		status = "waiting"
	}
	_ = c.manager.store.updateGeneration(c.sessionID, c.live.generation, status, c.rpc.cmd.Process.Pid, nil)
}

type providerReply struct {
	Generation int64               `json:"generation"`
	Decision   string              `json:"decision"`
	Answers    map[string][]string `json:"answers"`
}

func (c *codexConversation) reply(id string, body providerReply) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	q := c.requests[id]
	if q == nil || c.closed || c.live == nil || q.Generation != body.Generation || c.live.generation != body.Generation {
		return fmt.Errorf("this request is no longer active")
	}
	var result any
	if q.Kind == "approval" {
		valid := false
		for _, decision := range q.Decisions {
			if body.Decision == decision {
				valid = true
			}
		}
		if !valid {
			return fmt.Errorf("choose an available decision")
		}
		result = map[string]string{"decision": body.Decision}
	} else {
		answers := map[string]any{}
		if len(body.Answers) != len(q.Questions) {
			return fmt.Errorf("answer every question")
		}
		for _, question := range q.Questions {
			values, ok := body.Answers[question.ID]
			if !ok || len(values) != 1 || strings.TrimSpace(values[0]) == "" || len(values[0]) > 65536 {
				return fmt.Errorf("answer every question")
			}
			valid := question.IsOther || len(question.Options) == 0
			for _, option := range question.Options {
				if values[0] == option.Label {
					valid = true
				}
			}
			if !valid {
				return fmt.Errorf("choose an available answer")
			}
			answers[question.ID] = map[string]any{"answers": values}
		}
		result = map[string]any{"answers": answers}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.rpc.respond(ctx, q.wireID, result); err != nil {
		c.rpc.stop()
		return fmt.Errorf("provider disconnected before receiving the reply")
	}
	delete(c.requests, id)
	c.emitQuestionMarker(q, "answered")
	c.waitingState()
	return nil
}
func (c *codexConversation) interrupt(reason string) error {
	c.mu.Lock()
	if c.live == nil {
		c.mu.Unlock()
		return nil
	}
	live := c.live
	live.mu.Lock()
	live.stopRequested = true
	live.terminationReason = reason
	live.mu.Unlock()
	turn := c.providerTurn
	for _, q := range c.requests {
		c.emitQuestionMarker(q, "dismissed")
	}
	c.requests = map[string]*ProviderRequest{}
	c.mu.Unlock()
	if turn == "" {
		c.close()
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := c.rpc.request(ctx, "turn/interrupt", map[string]string{"threadId": c.threadID, "turnId": turn})
	if err != nil {
		c.close()
	}
	go func() {
		select {
		case <-live.done:
		case <-time.After(2 * time.Second):
			c.close()
		}
	}()
	return nil
}
func (m *SessionManager) steerCodex(id, messageID string) (bool, error) {
	release, err := m.deletions.admit(id)
	if err != nil {
		return true, err
	}
	defer release()
	if _, err := m.store.GetSession(id); err != nil {
		return true, err
	}
	c := m.codexClient(id)
	if c == nil {
		return false, nil
	}
	m.queueMu.Lock()
	defer m.queueMu.Unlock()
	c.mu.Lock()
	if c.closed || c.live == nil || c.providerTurn == "" || len(c.requests) > 0 || c.startDone != nil {
		c.mu.Unlock()
		return false, nil
	}
	live := c.live
	turn := c.providerTurn
	c.mu.Unlock()
	// Content and reservation are one SQLite statement: a concurrent edit
	// either completes before this claim or receives a conflict afterwards.
	message, err := scanQueuedMessage(m.store.db.QueryRow(`UPDATE message_queue SET status='steering',updated_at=? WHERE id=? AND session_id=? AND status='queued' RETURNING id,session_id,text,status,priority,created_at,updated_at`, encodeTime(time.Now().UTC()), messageID, id))
	if err != nil {
		return true, err
	}
	input, err := m.codexInput(message.Text)
	if err != nil {
		_, _ = m.store.db.Exec(`UPDATE message_queue SET status='queued' WHERE id=?`, messageID)
		return true, err
	}
	c.mu.Lock()
	if c.closed || c.live != live || c.providerTurn != turn || len(c.requests) > 0 || c.steering != nil {
		c.mu.Unlock()
		_, _ = m.store.db.Exec(`UPDATE message_queue SET status='queued' WHERE id=?`, messageID)
		return true, fmt.Errorf("this turn is no longer available for steering")
	}
	pending := &codexSteering{live: live, done: make(chan struct{})}
	c.steering = pending
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	data, err := c.rpc.request(ctx, "turn/steer", map[string]any{"threadId": c.threadID, "expectedTurnId": turn, "clientUserMessageId": messageID, "input": input})
	c.mu.Lock()
	defer c.mu.Unlock()
	c.steering = nil
	defer close(pending.done)
	var acknowledgement struct {
		TurnID string `json:"turnId"`
	}
	if err == nil && (json.Unmarshal(data, &acknowledgement) != nil || acknowledgement.TurnID != turn || pending.overflow) {
		err = fmt.Errorf("invalid steering acknowledgement")
	}
	flush := func() {
		for _, frame := range pending.frames {
			c.handle(frame)
		}
	}
	uncertain := func() {
		_, _ = m.store.db.Exec(`UPDATE message_queue SET status='uncertain' WHERE id=?`, messageID)
		c.rpc.stop()
		c.closed = true
		c.emit(map[string]any{"type": "error", "message": "Steering delivery could not be confirmed. Check the conversation before resending."})
		c.finish("failed")
	}
	if err != nil {
		var rejected *providerRPCError
		if errors.As(err, &rejected) && !pending.overflow {
			_, _ = m.store.db.Exec(`UPDATE message_queue SET status='queued' WHERE id=?`, messageID)
			flush()
			return true, fmt.Errorf("Codex could not steer this turn; the message remains queued")
		}
		uncertain()
		return true, fmt.Errorf("Codex did not acknowledge steering. Check the conversation before resending this message")
	}
	// Persist and publish the validated prompt before releasing the provider's
	// buffered output/completion. Response dispatch remains independent, so an
	// unrelated user-input request can still be answered while this RPC waits.
	_, err = m.store.db.Exec(`UPDATE messages SET turn_id=?,text=?,status='sent' WHERE id=? AND session_id=?`, live.turnID, message.Text, messageID, id)
	if err == nil {
		err = c.emit(map[string]string{"type": "openade.user_message", "text": message.Text, "created_at": encodeTime(time.Now().UTC())})
	}
	if err == nil {
		err = m.store.CompleteQueuedMessage(messageID)
	}
	if err != nil {
		uncertain()
		return true, fmt.Errorf("unable to record accepted steering; check the conversation before resending")
	}
	flush()
	return true, nil
}
