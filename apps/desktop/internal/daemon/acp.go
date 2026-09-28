package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// These are the ACP entry points in the pinned Zeron source. Cursor uses a
// separate native driver there; treating its CLI as ACP would be incorrect.
type acpSpec struct {
	program string
	args    []string
}

var acpSpecs = map[string]acpSpec{
	"grok":        {program: "grok", args: []string{"--no-auto-update", "agent", "--no-leader", "stdio"}},
	"devin":       {program: "devin", args: []string{"acp"}},
	"hermes":      {program: "hermes", args: []string{"acp"}},
	"pi":          {program: "pi-acp"},
	"antigravity": {program: "agy_acp_server"},
}

func isACPAgent(agent string) bool { _, ok := acpSpecs[strings.ToLower(agent)]; return ok }

func resolveACPProgram(agent string) (string, []string, error) {
	spec, ok := acpSpecs[strings.ToLower(agent)]
	if !ok {
		return "", nil, fmt.Errorf("%s does not have an ACP adapter", agent)
	}
	path, err := resolveProgram(spec.program)
	return path, spec.args, err
}

type acpPermissionOption struct {
	ID   string `json:"optionId"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type acpConversation struct {
	mu          sync.Mutex
	manager     *SessionManager
	sessionID   string
	providerID  string
	agent       string
	rpc         *providerRPC
	live        *liveSession
	transcript  *os.File
	requests    map[string]*ProviderRequest
	options     map[string][]acpPermissionOption
	context     ProviderContext
	idle        *time.Timer
	closed      bool
	nextRequest uint64
	progress    chan struct{}
	processed   uint64
	promptID    string
	completion  chan string
	warning     string
	state       acpSessionState
}

func (m *SessionManager) acpClient(id string) *acpConversation {
	m.providerMu.Lock()
	defer m.providerMu.Unlock()
	return m.acp[id]
}

func (c *acpConversation) close() {
	c.mu.Lock()
	if !c.closed {
		c.closed = true
		if c.idle != nil {
			c.idle.Stop()
		}
		c.rpc.stop()
	}
	c.mu.Unlock()
}

func (m *SessionManager) closeACPAndWait(id string, deadline time.Time) error {
	c := m.acpClient(id)
	if c == nil {
		return nil
	}
	c.close()
	select {
	case <-c.rpc.processDone:
		return nil
	case <-time.After(time.Until(deadline)):
		return fmt.Errorf("provider did not stop in time")
	}
}

func (m *SessionManager) startACPTurn(session Session) error {
	m.launchMu.Lock()
	defer m.launchMu.Unlock()
	if _, err := m.getLive(session.ID); err == nil {
		return fmt.Errorf("session is already running")
	}
	c := m.acpClient(session.ID)
	if c != nil {
		c.mu.Lock()
		closed := c.closed
		c.mu.Unlock()
		if closed {
			select {
			case <-c.rpc.processDone:
				m.providerMu.Lock()
				if m.acp[session.ID] == c {
					delete(m.acp, session.ID)
				}
				m.providerMu.Unlock()
				c = nil
			case <-time.After(3 * time.Second):
				return fmt.Errorf("previous ACP process did not stop in time")
			}
		}
	}
	if c == nil {
		var err error
		c, err = m.startACPClient(session)
		if err != nil {
			return err
		}
	}
	if err := c.applySelection(session.Model, session.Effort); err != nil {
		return err
	}
	var startTree string
	if session.Branch != "" {
		startTree, _ = snapshotWorkingTree(context.Background(), session.WorktreePath)
	}
	turnID, generation, err := m.store.BeginCodexTurn(session.ID, session.Prompt, session.queueMessageID, startTree)
	if err != nil {
		return err
	}
	transcript, err := os.OpenFile(filepath.Join(m.dataDir, "transcripts", session.ID+".log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
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
	live.acp = c
	c.mu.Lock()
	if c.closed || c.live != nil {
		c.mu.Unlock()
		_ = transcript.Close()
		_ = m.store.updateGeneration(session.ID, generation, "failed", 0, nil)
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return fmt.Errorf("ACP conversation is no longer available")
	}
	if c.idle != nil {
		c.idle.Stop()
	}
	c.live = live
	c.transcript = transcript
	c.requests = map[string]*ProviderRequest{}
	c.options = map[string][]acpPermissionOption{}
	c.promptID = uuid.NewString()
	c.completion = make(chan string, 1)
	c.mu.Unlock()
	m.mu.Lock()
	m.live[session.ID] = live
	m.mu.Unlock()
	if err := m.store.updateGeneration(session.ID, generation, "running", c.rpc.cmd.Process.Pid, nil); err != nil {
		c.mu.Lock()
		c.finish("failed")
		c.mu.Unlock()
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return err
	}
	c.mu.Lock()
	_ = c.emit(map[string]any{"type": "turn.started"})
	if c.warning != "" {
		_ = c.emit(map[string]any{"type": "error", "message": c.warning})
		c.warning = ""
	}
	promptID := c.promptID
	completion := c.completion
	c.mu.Unlock()
	params := map[string]any{"sessionId": c.providerID, "prompt": []map[string]string{{"type": "text", "text": conversationPrompt(session, session.Prompt)}}}
	if strings.EqualFold(session.Agent, "grok") {
		params["_meta"] = map[string]string{"promptId": promptID, "requestId": promptID}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	response, release, err := c.rpc.beginRequest(ctx, "session/prompt", params)
	cancel()
	if err != nil {
		c.mu.Lock()
		_ = c.emit(map[string]any{"type": "error", "message": "ACP could not send the prompt."})
		c.finish("failed")
		c.mu.Unlock()
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return err
	}
	if live.forkBootstrap {
		if err := m.store.markForkContextDelivered(session.ID, c.providerID); err != nil {
			c.mu.Lock()
			_ = c.emit(map[string]any{"type": "error", "message": "Unable to save side-chat history delivery; a later turn may repeat its context."})
			c.mu.Unlock()
		}
	}
	go c.awaitPrompt(live, response, release, completion)
	return nil
}

func (m *SessionManager) startACPClient(session Session) (*acpConversation, error) {
	program, args, err := resolveACPProgram(session.Agent)
	if err != nil {
		return nil, err
	}
	m.providerMu.Lock()
	var evict *acpConversation
	if len(m.acp) >= 8 {
		for _, candidate := range m.acp {
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
		select {
		case <-evict.rpc.processDone:
			m.providerMu.Lock()
			if m.acp[evict.sessionID] == evict {
				delete(m.acp, evict.sessionID)
			}
			m.providerMu.Unlock()
		case <-time.After(4 * time.Second):
			return nil, fmt.Errorf("idle ACP process did not stop in time")
		}
	}
	m.providerMu.Lock()
	full := len(m.acp) >= 8
	m.providerMu.Unlock()
	if full {
		return nil, fmt.Errorf("eight ACP chats are active; stop one before starting another")
	}
	rpc, err := startProviderRPC(program, args, session, true)
	if err != nil {
		return nil, fmt.Errorf("start %s ACP: %w", session.Agent, err)
	}
	c := &acpConversation{manager: m, sessionID: session.ID, agent: session.Agent, rpc: rpc, requests: map[string]*ProviderRequest{}, options: map[string][]acpPermissionOption{}, progress: make(chan struct{})}
	go c.events()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	capabilities := map[string]any{"fs": map[string]bool{"readTextFile": false, "writeTextFile": false}, "terminal": false}
	if strings.EqualFold(session.Agent, "devin") {
		capabilities["_meta"] = map[string]bool{"cognition.ai/subagentSupport": true}
	}
	_, err = rpc.request(ctx, "initialize", map[string]any{"protocolVersion": 1, "clientInfo": map[string]string{"name": "openade", "title": "OpenADE", "version": "0.4.0"}, "clientCapabilities": capabilities})
	if err != nil {
		c.close()
		return nil, fmt.Errorf("%s ACP initialization failed: %w", session.Agent, err)
	}
	params := map[string]any{"cwd": session.WorktreePath, "mcpServers": []any{}}
	method := "session/new"
	oldID := m.providerID(session)
	if oldID != "" {
		method = "session/load"
		params["sessionId"] = oldID
	}
	data, err := rpc.request(ctx, method, params)
	if err != nil && oldID != "" {
		c.mu.Lock()
		c.warning = fmt.Sprintf("%s could not restore its previous conversation; this turn starts without that provider context.", session.Agent)
		c.mu.Unlock()
		delete(params, "sessionId")
		data, err = rpc.request(ctx, "session/new", params)
	}
	var result acpSessionState
	if err == nil {
		err = json.Unmarshal(data, &result)
	}
	if err != nil || result.SessionID == "" || len(result.SessionID) > 512 {
		c.close()
		return nil, fmt.Errorf("%s ACP could not open a conversation", session.Agent)
	}
	c.mu.Lock()
	c.providerID = result.SessionID
	c.state = result
	closed := c.closed
	c.mu.Unlock()
	if closed {
		return nil, fmt.Errorf("%s ACP disconnected during setup", session.Agent)
	}
	if err := m.writeProviderSessionMarker(session, result.SessionID); err != nil {
		c.close()
		return nil, err
	}
	m.providerMu.Lock()
	m.acp[session.ID] = c
	c.idle = time.AfterFunc(codexIdleTimeout, c.close)
	m.providerMu.Unlock()
	return c, nil
}

func (c *acpConversation) awaitPrompt(live *liveSession, response <-chan providerRPCResult, release func(), completion <-chan string) {
	defer release()
	status := "completed"
	var message string
	select {
	case result := <-response:
		if result.err != nil {
			status, message = "failed", "The ACP provider disconnected or rejected the prompt."
		} else {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := c.waitThrough(ctx, result.through); err != nil {
				status, message = "failed", "The ACP provider ended before its updates could be processed."
			}
			cancel()
			var resultBody struct {
				StopReason string `json:"stopReason"`
			}
			if json.Unmarshal(result.value, &resultBody) != nil || resultBody.StopReason == "" {
				status, message = "failed", "The ACP provider returned an invalid prompt result."
			} else {
				status, message = acpStopOutcome(resultBody.StopReason)
			}
		}
	case stop := <-completion:
		status, message = acpStopOutcome(stop)
	case <-c.rpc.done:
		// The final response may have been buffered just before EOF.
		select {
		case result := <-response:
			if result.err == nil {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				if c.waitThrough(ctx, result.through) == nil {
					var body struct {
						StopReason string `json:"stopReason"`
					}
					if json.Unmarshal(result.value, &body) == nil {
						status, message = acpStopOutcome(body.StopReason)
					} else {
						status, message = "failed", "The ACP provider returned an invalid prompt result."
					}
				} else {
					status, message = "failed", "The ACP provider ended before its updates could be processed."
				}
				cancel()
			} else {
				status, message = "failed", "The ACP provider connection closed before this turn completed."
			}
		default:
			status, message = "failed", "The ACP provider connection closed before this turn completed."
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.live != live {
		return
	}
	if message != "" {
		_ = c.emit(map[string]any{"type": "error", "message": message})
	}
	_ = c.emit(map[string]any{"type": "turn.completed", "created_at": encodeTime(time.Now().UTC())})
	c.finish(status)
}

func acpStopOutcome(reason string) (string, string) {
	switch reason {
	case "cancelled":
		return "interrupted", ""
	case "error":
		return "failed", "The agent failed to complete the turn."
	case "refusal":
		return "failed", "The agent refused to continue."
	case "end_turn", "max_tokens", "max_turn_requests":
		return "completed", ""
	default:
		return "failed", "The agent returned an unknown stop reason."
	}
}

func (c *acpConversation) waitThrough(ctx context.Context, sequence uint64) error {
	for {
		c.mu.Lock()
		if c.processed >= sequence {
			c.mu.Unlock()
			return nil
		}
		if c.closed {
			c.mu.Unlock()
			return fmt.Errorf("ACP connection closed")
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

func (c *acpConversation) events() {
	for frame := range c.rpc.events {
		c.rpc.consume(frame)
		c.mu.Lock()
		c.handle(frame)
		c.processed = frame.sequence
		close(c.progress)
		c.progress = make(chan struct{})
		c.mu.Unlock()
	}
	c.rpc.stop()
	c.mu.Lock()
	live := c.live
	c.mu.Unlock()
	if live != nil {
		// Let the prompt-result owner settle a response buffered before EOF.
		select {
		case <-live.done:
		case <-time.After(6 * time.Second):
		}
	}
	c.mu.Lock()
	c.closed = true
	if c.idle != nil {
		c.idle.Stop()
	}
	if c.live != nil {
		_ = c.emit(map[string]any{"type": "error", "message": "The ACP provider connection closed before this turn completed."})
		c.finish("failed")
	}
	c.mu.Unlock()
	c.manager.providerMu.Lock()
	if c.manager.acp[c.sessionID] == c {
		delete(c.manager.acp, c.sessionID)
	}
	c.manager.providerMu.Unlock()
}

func (c *acpConversation) handle(frame providerRPCFrame) {
	if len(frame.ID) > 0 {
		c.handleRequest(frame)
		return
	}
	if frame.Method == "_x.ai/session/prompt_complete" && strings.EqualFold(c.agent, "grok") && c.live != nil {
		var notice struct {
			SessionID, PromptID, StopReason string
		}
		if json.Unmarshal(frame.Params, &notice) == nil && notice.SessionID == c.providerID && notice.PromptID == c.promptID && notice.PromptID != "" {
			select {
			case c.completion <- notice.StopReason:
			default:
			}
		}
		return
	}
	if frame.Method != "session/update" {
		return
	}
	var update struct {
		SessionID string          `json:"sessionId"`
		Update    json.RawMessage `json:"update"`
	}
	if json.Unmarshal(frame.Params, &update) != nil || update.SessionID != c.providerID {
		return
	}
	var body struct {
		Kind          string                      `json:"sessionUpdate"`
		Content       struct{ Type, Text string } `json:"content"`
		Title         string                      `json:"title"`
		Status        string                      `json:"status"`
		ToolID        string                      `json:"toolCallId"`
		Used          *uint64                     `json:"used"`
		Size          *uint64                     `json:"size"`
		Max           *uint64                     `json:"max"`
		Limit         *uint64                     `json:"limit"`
		Window        *uint64                     `json:"contextWindow"`
		Window2       *uint64                     `json:"context_window"`
		ConfigOptions []acpConfigOption           `json:"configOptions"`
	}
	if json.Unmarshal(update.Update, &body) != nil {
		return
	}
	if body.Kind == "config_option_update" {
		if body.ConfigOptions != nil {
			c.state.ConfigOptions = body.ConfigOptions
		}
		return
	}
	if c.live == nil {
		return
	}
	switch body.Kind {
	case "agent_message_chunk":
		if body.Content.Type == "text" && body.Content.Text != "" {
			_ = c.emit(map[string]any{"type": "openade.agent_delta", "id": c.live.turnID, "text": body.Content.Text})
		}
	case "agent_thought_chunk":
		_ = c.emit(map[string]any{"type": "stream_event", "event": map[string]any{"delta": map[string]string{"type": "thinking_delta"}}})
	case "tool_call", "tool_call_update":
		if body.Kind == "tool_call_update" && body.ToolID == "" {
			return
		}
		title := strings.TrimSpace(body.Title)
		if title == "" {
			title = "Used a tool"
		}
		if len(title) > 512 {
			title = title[:512]
		}
		_ = c.emit(map[string]any{"type": "openade.tool", "id": body.ToolID, "title": title, "detail": body.Status})
	case "usage_update":
		if body.Used != nil {
			c.context.Tokens = body.Used
		}
		for _, window := range []*uint64{body.Max, body.Limit, body.Size, body.Window, body.Window2} {
			if window != nil && *window > 0 {
				c.context.Window = window
				break
			}
		}
		c.saveContext()
	}
}

func (c *acpConversation) handleRequest(frame providerRPCFrame) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if frame.Method != "session/request_permission" {
		_ = c.rpc.reject(ctx, frame.ID, -32601, "Unsupported ACP client method")
		return
	}
	var input struct {
		SessionID string `json:"sessionId"`
		ToolCall  struct {
			Title string `json:"title"`
		} `json:"toolCall"`
		Options []acpPermissionOption `json:"options"`
	}
	if json.Unmarshal(frame.Params, &input) != nil || c.live == nil || input.SessionID != c.providerID || len(input.Options) == 0 || len(input.Options) > 12 {
		_ = c.rpc.respond(ctx, frame.ID, map[string]any{"outcome": map[string]string{"outcome": "cancelled"}})
		return
	}
	if len(c.requests) >= 8 || len(frame.ID) > 256 {
		_ = c.rpc.respond(ctx, frame.ID, map[string]any{"outcome": map[string]string{"outcome": "cancelled"}})
		return
	}
	q := &ProviderRequest{ID: uuid.NewString(), Generation: c.live.generation, Kind: "question", Title: "Agent permission", Questions: []ProviderQuestion{}, wireID: append(json.RawMessage(nil), frame.ID...), method: frame.Method}
	c.nextRequest++
	q.order = c.nextRequest
	question := ProviderQuestion{ID: "choice", Header: "Agent request", Question: strings.TrimSpace(input.ToolCall.Title), Options: []ProviderOption{}}
	if question.Question == "" {
		question.Question = "Choose how the agent should continue."
	}
	if len(question.Question) > 32768 {
		question.Question = question.Question[:32768]
	}
	used := map[string]int{}
	for _, option := range input.Options {
		if option.ID == "" || len(option.ID) > 256 || len(option.Name) > 4096 {
			continue
		}
		label := strings.TrimSpace(option.Name)
		if label == "" {
			continue
		}
		used[label]++
		if used[label] > 1 {
			label = fmt.Sprintf("%s (%d)", label, used[label])
		}
		option.Name = label
		question.Options = append(question.Options, ProviderOption{Label: label})
		c.options[q.ID] = append(c.options[q.ID], option)
	}
	if len(question.Options) == 0 {
		delete(c.options, q.ID)
		_ = c.rpc.respond(ctx, frame.ID, map[string]any{"outcome": map[string]string{"outcome": "cancelled"}})
		return
	}
	q.Questions = []ProviderQuestion{question}
	c.requests[q.ID] = q
	_ = c.manager.store.updateGeneration(c.sessionID, c.live.generation, "waiting", c.rpc.cmd.Process.Pid, nil)
}

func (c *acpConversation) reply(id string, body providerReply) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	q := c.requests[id]
	if q == nil || c.closed || c.live == nil || q.Generation != body.Generation || c.live.generation != body.Generation {
		return fmt.Errorf("this request is no longer active")
	}
	answers := body.Answers["choice"]
	if len(body.Answers) != 1 || len(answers) != 1 {
		return fmt.Errorf("choose one available answer")
	}
	optionID := ""
	for _, option := range c.options[id] {
		if option.Name == answers[0] {
			optionID = option.ID
			break
		}
	}
	if optionID == "" {
		return fmt.Errorf("choose one available answer")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.rpc.respond(ctx, q.wireID, map[string]any{"outcome": map[string]string{"outcome": "selected", "optionId": optionID}}); err != nil {
		c.rpc.stop()
		return fmt.Errorf("provider disconnected before receiving the reply")
	}
	delete(c.requests, id)
	delete(c.options, id)
	_ = c.manager.store.updateGeneration(c.sessionID, c.live.generation, "running", c.rpc.cmd.Process.Pid, nil)
	return nil
}

func (c *acpConversation) interrupt(reason string) error {
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
	c.requests = map[string]*ProviderRequest{}
	c.options = map[string][]acpPermissionOption{}
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	err := c.rpc.notify(ctx, "session/cancel", map[string]string{"sessionId": c.providerID})
	cancel()
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

func (c *acpConversation) saveContext() {
	data, _ := json.Marshal(c.context)
	_, _ = c.manager.store.db.Exec(`INSERT INTO provider_context(session_id,state) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state`, c.sessionID, string(data))
}

// emit, finish and handle always run with c.mu held. Provider wire data is
// normalized before it reaches the local transcript or a subscribed window.
func (c *acpConversation) emit(event any) error {
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

func (c *acpConversation) finish(status string) {
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
		_ = c.manager.store.markForkContextDelivered(c.sessionID, c.providerID)
	}
	c.manager.mu.Lock()
	if c.manager.live[c.sessionID] == live {
		delete(c.manager.live, c.sessionID)
	}
	c.manager.mu.Unlock()
	if c.transcript != nil {
		_ = c.transcript.Close()
		c.transcript = nil
	}
	c.requests = map[string]*ProviderRequest{}
	c.options = map[string][]acpPermissionOption{}
	c.live = nil
	c.promptID = ""
	c.completion = nil
	live.mu.Lock()
	for ch := range live.subscribers {
		close(ch)
	}
	live.subscribers = map[chan []byte]struct{}{}
	live.mu.Unlock()
	close(live.readDone)
	close(live.done)
	if !c.closed {
		c.idle = time.AfterFunc(codexIdleTimeout, c.close)
	}
	if status == "completed" {
		c.manager.maybeGenerateTitle(c.sessionID, live.generation)
		go func() { _ = c.manager.DrainQueue(c.sessionID) }()
	}
}
