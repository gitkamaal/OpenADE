package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const maxPendingClaudeSteers = 32
const claudeSteerSettle = 5 * time.Second

type claudeSteer struct {
	queueID string
	wireID  string
	text    string
}

func (s *claudeSubagents) steeringAvailable() bool {
	s.requestsMu.Lock()
	questionPending := len(s.requests) > 0
	s.requestsMu.Unlock()
	s.inputMu.Lock()
	inputOpen := s.input != nil && !s.inputClosed
	s.inputMu.Unlock()
	s.steerMu.Lock()
	room := len(s.steers) < maxPendingClaudeSteers
	s.steerMu.Unlock()
	return !questionPending && inputOpen && room
}

func (s *claudeSubagents) sendSteer(message QueuedMessage) (string, error) {
	if !s.steeringAvailable() {
		return "", errClaudeInputClosed
	}
	wireID := uuid.NewString()
	s.steerMu.Lock()
	priority := "now"
	if len(s.openTools) > 0 || s.toolsOverflow {
		priority = "next"
	}
	s.steers = append(s.steers, claudeSteer{queueID: message.ID, wireID: wireID, text: message.Text})
	s.steerMu.Unlock()
	err := s.writeFrame(map[string]any{
		"type": "user", "uuid": wireID, "priority": priority,
		"message": map[string]string{"role": "user", "content": message.Text}, "parent_tool_use_id": nil,
	})
	if errors.Is(err, errClaudeInputClosed) {
		s.forgetSteer(wireID)
	}
	return wireID, err
}

func (s *claudeSubagents) forgetSteer(wireID string) {
	s.steerMu.Lock()
	defer s.steerMu.Unlock()
	for index, steer := range s.steers {
		if steer.wireID == wireID {
			s.steers = append(s.steers[:index], s.steers[index+1:]...)
			return
		}
	}
}

func (s *claudeSubagents) trackSteeringTools(frame *claudeWireFrame) {
	if frame.Type != "assistant" && frame.Type != "user" && frame.Type != "result" {
		return
	}
	s.steerMu.Lock()
	defer s.steerMu.Unlock()
	if frame.Type == "result" {
		clear(s.openTools)
		s.toolsOverflow = false
		return
	}
	for _, block := range frame.blocks() {
		if frame.Type == "assistant" && block.Type == "tool_use" && block.ID != "" {
			if len(s.openTools) < 128 {
				s.openTools[block.ID] = struct{}{}
			} else {
				s.toolsOverflow = true
			}
		} else if frame.Type == "user" && block.Type == "tool_result" {
			delete(s.openTools, block.ToolUseID)
		}
	}
}

func (s *claudeSubagents) confirmSteerReplay(wireID string) []byte {
	s.steerMu.Lock()
	index := -1
	for at, steer := range s.steers {
		if steer.wireID == wireID {
			index = at
			break
		}
	}
	if index < 0 {
		s.steerMu.Unlock()
		return nil
	}
	confirmed := append([]claudeSteer(nil), s.steers[:index+1]...)
	s.steers = append([]claudeSteer(nil), s.steers[index+1:]...)
	if len(s.steers) == 0 {
		s.heldResult = nil
		if s.heldTimer != nil {
			s.heldTimer.Stop()
		}
	} else if len(s.heldResult) > 0 && s.heldTimer != nil {
		s.heldTimer.Reset(claudeSteerSettle)
	}
	s.steerMu.Unlock()
	out := make([]byte, 0, len(confirmed)*128)
	for _, steer := range confirmed {
		if err := s.recordConfirmedSteer(steer); err != nil {
			s.markSteerUncertain(steer.queueID)
			warning, _ := json.Marshal(map[string]string{"type": "error", "message": "Claude accepted a message, but OpenADE could not save its delivery. Review the conversation before retrying."})
			out = append(out, warning...)
			out = append(out, '\n')
			continue
		}
		marker, _ := json.Marshal(map[string]string{"type": "openade.user_message", "text": steer.text, "created_at": encodeTime(time.Now().UTC())})
		out = append(out, marker...)
		out = append(out, '\n')
	}
	return out
}

func (s *claudeSubagents) recordConfirmedSteer(steer claudeSteer) error {
	tx, err := s.store.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE messages SET turn_id=?,text=?,status='sent' WHERE id=? AND session_id=?`, s.live.turnID, steer.text, steer.queueID, s.sessionID)
	if err != nil {
		return err
	}
	if err = requireAffected(result, "steered message"); err != nil {
		return err
	}
	result, err = tx.Exec(`DELETE FROM message_queue WHERE id=? AND session_id=? AND status='steering'`, steer.queueID, s.sessionID)
	if err != nil {
		return err
	}
	if err = requireAffected(result, "steered queue entry"); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *claudeSubagents) markSteerUncertain(queueID string) {
	_, _ = s.store.db.Exec(`UPDATE message_queue SET status='uncertain',updated_at=? WHERE id=? AND session_id=? AND status='steering'`, encodeTime(time.Now().UTC()), queueID, s.sessionID)
}

func (s *claudeSubagents) holdResultIfSteering(raw []byte) bool {
	s.steerMu.Lock()
	defer s.steerMu.Unlock()
	if len(s.steers) == 0 {
		return false
	}
	s.heldResult = append(append([]byte(nil), raw...), '\n')
	if s.heldTimer == nil {
		s.heldTimer = time.AfterFunc(claudeSteerSettle, s.expireHeldResult)
	} else {
		s.heldTimer.Reset(claudeSteerSettle)
	}
	return true
}

func (s *claudeSubagents) touchHeldResult() {
	s.steerMu.Lock()
	if len(s.heldResult) > 0 && s.heldTimer != nil {
		s.heldTimer.Reset(claudeSteerSettle)
	}
	s.steerMu.Unlock()
}

func (s *claudeSubagents) expireHeldResult() {
	s.steerMu.Lock()
	defer s.steerMu.Unlock()
	if len(s.heldResult) > 0 && len(s.steers) > 0 {
		s.closeInput()
	}
}

func (s *claudeSubagents) releaseHeldResult() []byte {
	s.steerMu.Lock()
	defer s.steerMu.Unlock()
	result := s.heldResult
	s.heldResult = nil
	if s.heldTimer != nil {
		s.heldTimer.Stop()
	}
	return result
}

func (s *claudeSubagents) finishSteering() {
	s.steerMu.Lock()
	pending := append([]claudeSteer(nil), s.steers...)
	s.steers = nil
	if s.heldTimer != nil {
		s.heldTimer.Stop()
	}
	s.steerMu.Unlock()
	for _, steer := range pending {
		s.markSteerUncertain(steer.queueID)
	}
	if len(pending) > 0 {
		warning, _ := json.Marshal(map[string]string{"type": "error", "message": fmt.Sprintf("Claude did not replay %d queued message(s). Review the conversation before retrying.", len(pending))})
		s.emit(append(warning, '\n'))
	}
}

func (m *SessionManager) steerClaude(id, messageID string) (bool, error) {
	release, err := m.deletions.admit(id)
	if err != nil {
		return true, err
	}
	defer release()
	s := m.claudeClient(id)
	if s == nil || !s.steeringAvailable() {
		return false, nil
	}
	m.queueMu.Lock()
	defer m.queueMu.Unlock()
	if m.claudeClient(id) != s || !s.steeringAvailable() {
		return false, nil
	}
	message, err := scanQueuedMessage(m.store.db.QueryRow(`UPDATE message_queue SET status='steering',updated_at=? WHERE id=? AND session_id=? AND status='queued' RETURNING id,session_id,text,status,priority,created_at,updated_at`, encodeTime(time.Now().UTC()), messageID, id))
	if err != nil {
		return true, err
	}
	_, err = s.sendSteer(message)
	if err != nil {
		var status string
		if m.store.db.QueryRow(`SELECT status FROM messages WHERE id=? AND session_id=?`, message.ID, id).Scan(&status) == nil && status == "sent" {
			return true, nil // Replay may have committed before the write returned.
		}
	}
	if errors.Is(err, errClaudeInputClosed) {
		_, _ = m.store.db.Exec(`UPDATE message_queue SET status='queued',updated_at=? WHERE id=? AND status='steering'`, encodeTime(time.Now().UTC()), message.ID)
		return true, fmt.Errorf("Claude cannot steer this turn; the message remains queued")
	}
	if err != nil {
		s.markSteerUncertain(message.ID)
		return true, fmt.Errorf("Claude steering delivery was not confirmed; review the conversation before retrying")
	}
	return true, nil
}
