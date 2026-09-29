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
)

type cursorConversation struct {
	mu         sync.Mutex
	manager    *SessionManager
	sessionID  string
	providerID string
	model      string
	wire       *cursorWire
	live       *liveSession
	transcript *os.File
	idle       *time.Timer
	closed     bool
}

func (m *SessionManager) cursorClient(id string) *cursorConversation {
	m.providerMu.Lock()
	defer m.providerMu.Unlock()
	return m.cursor[id]
}

func (c *cursorConversation) close() {
	c.mu.Lock()
	if !c.closed {
		c.closed = true
		if c.idle != nil {
			c.idle.Stop()
		}
		c.wire.stop()
	}
	c.mu.Unlock()
}

func (m *SessionManager) closeCursorAndWait(id string, deadline time.Time) error {
	c := m.cursorClient(id)
	if c == nil {
		return nil
	}
	c.close()
	select {
	case <-c.wire.processDone:
		return nil
	case <-time.After(time.Until(deadline)):
		return fmt.Errorf("Cursor provider did not stop in time")
	}
}

func (m *SessionManager) startCursorTurn(session Session) error {
	m.launchMu.Lock()
	defer m.launchMu.Unlock()
	if _, err := m.getLive(session.ID); err == nil {
		return fmt.Errorf("session is already running")
	}
	c := m.cursorClient(session.ID)
	if c != nil {
		c.mu.Lock()
		closed, model := c.closed, c.model
		c.mu.Unlock()
		if closed || model != session.Model {
			c.close()
			select {
			case <-c.wire.processDone:
				m.providerMu.Lock()
				if m.cursor[session.ID] == c {
					delete(m.cursor, session.ID)
				}
				m.providerMu.Unlock()
				c = nil
			case <-time.After(4 * time.Second):
				return fmt.Errorf("previous Cursor process did not stop in time")
			}
		}
	}
	newProcess := c == nil
	if newProcess {
		var err error
		c, err = m.startCursorClient(session)
		if err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Join(m.dataDir, "transcripts"), 0o700); err != nil {
		if newProcess {
			c.close()
		}
		return err
	}
	var startTree string
	if session.Branch != "" {
		startTree, _ = snapshotWorkingTree(context.Background(), session.WorktreePath)
	}
	turnID, generation, err := m.store.BeginCodexTurn(session.ID, session.Prompt, session.queueMessageID, startTree)
	if err != nil {
		if newProcess {
			c.close()
		}
		return err
	}
	transcript, err := os.OpenFile(filepath.Join(m.dataDir, "transcripts", session.ID+".log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		_ = m.store.updateGeneration(session.ID, generation, "failed", 0, nil)
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return err
	}
	live := newLiveSession(nil, c.wire.cmd)
	live.rawPTY = false
	live.cursor = c
	live.forkBootstrap = session.forkBootstrap
	live.generation = generation
	live.turnID = turnID
	c.mu.Lock()
	if c.closed || c.live != nil {
		c.mu.Unlock()
		_ = transcript.Close()
		_ = m.store.updateGeneration(session.ID, generation, "failed", 0, nil)
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return fmt.Errorf("Cursor conversation is no longer available")
	}
	if c.idle != nil {
		c.idle.Stop()
	}
	c.live, c.transcript = live, transcript
	c.mu.Unlock()
	m.mu.Lock()
	m.live[session.ID] = live
	m.mu.Unlock()
	if err := m.store.updateGeneration(session.ID, generation, "running", c.wire.cmd.Process.Pid, nil); err != nil {
		c.mu.Lock()
		c.finish("failed")
		c.mu.Unlock()
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return err
	}
	c.mu.Lock()
	_ = c.emit(map[string]any{"type": "turn.started"})
	c.mu.Unlock()
	prompt := conversationPrompt(session, session.Prompt)
	var command map[string]any
	if newProcess {
		command = map[string]any{"op": "run", "prompt": prompt, "cwd": session.WorktreePath, "model": session.Model, "resume": m.providerID(session), "storeDir": filepath.Join(cursorStateDir(m.dataDir), "agents", session.ID)}
	} else {
		command = map[string]any{"op": "user", "prompt": prompt}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err = c.wire.send(ctx, command)
	cancel()
	if err != nil {
		c.mu.Lock()
		_ = c.emit(map[string]any{"type": "error", "message": "Cursor could not accept the prompt."})
		c.finish("failed")
		c.mu.Unlock()
		c.close()
		_ = m.store.ReleaseUnsentCodexMessage(session.queueMessageID)
		return err
	}
	return nil
}

func (m *SessionManager) startCursorClient(session Session) (*cursorConversation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	program, args, err := m.resolveCursorRuntime(ctx)
	if err != nil {
		return nil, err
	}
	m.providerMu.Lock()
	var evict *cursorConversation
	if len(m.cursor) >= 8 {
		for _, candidate := range m.cursor {
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
		case <-evict.wire.processDone:
			m.providerMu.Lock()
			if m.cursor[evict.sessionID] == evict {
				delete(m.cursor, evict.sessionID)
			}
			m.providerMu.Unlock()
		case <-time.After(4 * time.Second):
			return nil, fmt.Errorf("idle Cursor process did not stop in time")
		}
	}
	m.providerMu.Lock()
	full := len(m.cursor) >= 8
	m.providerMu.Unlock()
	if full {
		return nil, fmt.Errorf("eight Cursor chats are active; stop one before starting another")
	}
	stateDir := cursorStateDir(m.dataDir)
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return nil, err
	}
	wire, err := startCursorWire(program, args, session, stateDir)
	if err != nil {
		return nil, fmt.Errorf("start Cursor SDK: %w", err)
	}
	c := &cursorConversation{manager: m, sessionID: session.ID, model: session.Model, wire: wire}
	m.providerMu.Lock()
	m.cursor[session.ID] = c
	m.providerMu.Unlock()
	go c.events()
	return c, nil
}

func (c *cursorConversation) events() {
	for frame := range c.wire.events {
		c.mu.Lock()
		c.handle(frame)
		c.mu.Unlock()
	}
	c.wire.stop()
	c.mu.Lock()
	c.closed = true
	if c.idle != nil {
		c.idle.Stop()
	}
	if c.live != nil {
		message := "The Cursor SDK process closed before this turn completed."
		if err := c.wire.readError(); err != nil {
			message = err.Error()
		}
		_ = c.emit(map[string]any{"type": "error", "message": message})
		c.finish("failed")
	}
	c.mu.Unlock()
	c.manager.providerMu.Lock()
	if c.manager.cursor[c.sessionID] == c {
		delete(c.manager.cursor, c.sessionID)
	}
	c.manager.providerMu.Unlock()
}

// handle, emit and finish run with c.mu held.
func (c *cursorConversation) handle(frame cursorFrame) {
	if frame.Event == "ready" {
		if frame.AgentID == "" || len(frame.AgentID) > 512 {
			if c.live != nil {
				_ = c.emit(map[string]any{"type": "error", "message": "Cursor returned an invalid conversation identity."})
				c.finish("failed")
			}
			c.closed = true
			c.wire.stop()
			return
		}
		if c.providerID != "" {
			if c.providerID != frame.AgentID {
				if c.live != nil {
					_ = c.emit(map[string]any{"type": "error", "message": "Cursor changed its conversation identity unexpectedly."})
					c.finish("failed")
				}
				c.closed = true
				c.wire.stop()
			}
			return
		}
		c.providerID = frame.AgentID
		if c.live != nil {
			// Cursor announces its identity after the active stream starts.
			// Append the marker through the live stream so WebSocket byte
			// cursors include it; a direct transcript append would make a
			// later reconnect resume in the middle of a JSON event.
			_, err := c.manager.store.db.Exec(`UPDATE sessions SET provider_session_id=? WHERE id=?`, frame.AgentID, c.sessionID)
			if err == nil {
				err = c.emit(map[string]any{"type": "openade.provider_session", "session_id": frame.AgentID})
			}
			if err != nil {
				_ = c.emit(map[string]any{"type": "error", "message": "Cursor conversation identity could not be saved."})
				c.finish("failed")
				c.closed = true
				c.wire.stop()
			}
		}
		return
	}
	if c.live == nil {
		return
	}
	switch frame.Event {
	case "text":
		if frame.Text != "" {
			if frame.Parent == "" {
				_ = c.emit(map[string]any{"type": "openade.agent_delta", "id": c.live.turnID, "text": frame.Text})
			} else {
				_ = c.emit(map[string]any{"type": "openade.tool", "id": frame.Parent, "title": "Subagent", "detail": frame.Text})
			}
		}
	case "thinking":
		_ = c.emit(map[string]any{"type": "stream_event", "event": map[string]any{"delta": map[string]string{"type": "thinking_delta", "thinking": frame.Text}}})
	case "tool":
		if frame.ID == "" || len(frame.ID) > 512 {
			return
		}
		title := strings.TrimSpace(frame.Name)
		if title == "" {
			title = "Used a tool"
		}
		if len(title) > 512 {
			title = title[:512]
		}
		if frame.Parent != "" {
			title = "Subagent: " + title
		}
		_ = c.emit(map[string]any{"type": "openade.tool", "id": frame.ID, "title": title, "detail": frame.Phase})
	case "usage":
		// Cursor exposes per-turn tokens here, but no context-window capacity.
		// Do not turn input+output into a misleading context-ring percentage.
		_ = c.emit(map[string]any{"type": "openade.usage", "input": frame.Input, "output": frame.Output})
	case "fatal", "turn":
		status := "completed"
		message := ""
		if frame.Event == "fatal" || frame.Status == "error" {
			status = "failed"
			_ = json.Unmarshal(frame.Error, &message)
			if frame.Event == "fatal" {
				message = frame.Message
			}
		} else if frame.Status == "cancelled" {
			status = "interrupted"
		} else if frame.Status != "finished" {
			status, message = "failed", "Cursor returned an unknown turn status."
		}
		if c.providerID == "" && status == "completed" {
			status, message = "failed", "Cursor completed without a resumable conversation identity."
		}
		if message != "" {
			if len(message) > 4096 {
				message = message[:4096]
			}
			_ = c.emit(map[string]any{"type": "error", "message": message})
		}
		_ = c.emit(map[string]any{"type": "turn.completed", "created_at": encodeTime(time.Now().UTC())})
		c.finish(status)
		if status == "failed" {
			c.closed = true
			c.wire.stop()
		}
	}
}

func (c *cursorConversation) interrupt(reason string) error {
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
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	err := c.wire.send(ctx, map[string]string{"op": "interrupt"})
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

func (c *cursorConversation) emit(event any) error {
	if c.live == nil {
		return fmt.Errorf("no active Cursor turn")
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

func (c *cursorConversation) finish(status string) {
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
	c.live = nil
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
