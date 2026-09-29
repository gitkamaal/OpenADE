package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

type claudePendingQuestion struct {
	request *ProviderRequest
	wireID  string
	input   map[string]any
}

func (s *claudeSubagents) attachInput(input *os.File, pid int) {
	s.input = input
	s.pid = pid
}

func (s *claudeSubagents) attachOutput(live *liveSession, transcript *os.File) {
	s.live = live
	s.transcript = transcript
}

func (s *claudeSubagents) writeFrame(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(data) > maxPendingChildBytes {
		return fmt.Errorf("Claude input exceeded its 4 MiB limit")
	}
	s.inputMu.Lock()
	defer s.inputMu.Unlock()
	if s.inputClosed || s.input == nil {
		return errors.New("Claude input is closed")
	}
	if err := s.input.SetWriteDeadline(time.Now().Add(3 * time.Second)); err != nil {
		return err
	}
	_, err = s.input.Write(append(data, '\n'))
	_ = s.input.SetWriteDeadline(time.Time{})
	if err != nil {
		_ = s.input.Close()
		s.inputClosed = true
	}
	return err
}

func (s *claudeSubagents) closeInput() {
	s.inputMu.Lock()
	defer s.inputMu.Unlock()
	if !s.inputClosed && s.input != nil {
		s.inputClosed = true
		_ = s.input.Close()
	}
}

func (s *claudeSubagents) sendInitial(prompt string) error {
	return s.writeFrame(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": prompt}, "parent_tool_use_id": nil})
}

func (s *claudeSubagents) controlResponse(id string, response any) error {
	return s.writeFrame(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": id, "response": response}})
}

func (s *claudeSubagents) denyControl(id, reason string) {
	_ = s.controlResponse(id, map[string]any{"behavior": "deny", "message": reason})
}

func (s *claudeSubagents) handleControlRequest(frame *claudeWireFrame) []byte {
	id := frame.RequestID
	if id == "" || len(id) > 256 {
		return nil
	}
	if frame.Request.Subtype != "can_use_tool" {
		s.denyControl(id, "Unsupported Claude control request")
		return nil
	}
	if len(frame.Request.Input) > 256*1024 {
		s.denyControl(id, "Tool input exceeded its display limit")
		return nil
	}
	if frame.Request.ToolName != "AskUserQuestion" {
		input := frame.Request.Input
		if len(input) == 0 {
			input = json.RawMessage(`{}`)
		}
		_ = s.controlResponse(id, map[string]any{"behavior": "allow", "updatedInput": input})
		return nil
	}
	questions, input, err := parseClaudeQuestions(frame.Request.Input)
	if err != nil {
		s.denyControl(id, "Question could not be displayed")
		return []byte("{\"type\":\"error\",\"message\":\"Claude asked a question OpenADE could not display; nothing was approved.\"}\n")
	}
	s.requestsMu.Lock()
	if len(s.requests) >= 8 {
		s.requestsMu.Unlock()
		s.denyControl(id, "Too many pending questions")
		return nil
	}
	s.nextRequest++
	q := &ProviderRequest{ID: uuid.NewString(), Generation: s.generation, Kind: "question", Title: "Your input is needed", Questions: questions, Decisions: []string{}, order: s.nextRequest}
	s.requests[q.ID] = &claudePendingQuestion{request: q, wireID: id, input: input}
	s.requestsMu.Unlock()
	_ = s.store.updateGeneration(s.sessionID, s.generation, "waiting", s.pid, nil)
	return claudeQuestionMarker(q, "pending")
}

func parseClaudeQuestions(raw json.RawMessage) ([]ProviderQuestion, map[string]any, error) {
	var input map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &input) != nil || input == nil {
		return nil, nil, errors.New("invalid question input")
	}
	entries, ok := input["questions"].([]any)
	if !ok || len(entries) == 0 || len(entries) > 12 {
		return nil, nil, errors.New("invalid question count")
	}
	questions := make([]ProviderQuestion, 0, len(entries))
	for _, entry := range entries {
		row, ok := entry.(map[string]any)
		if !ok {
			return nil, nil, errors.New("invalid question")
		}
		pick := func(a, b string) string {
			value, _ := row[a].(string)
			if value == "" {
				value, _ = row[b].(string)
			}
			return strings.TrimSpace(value)
		}
		q := ProviderQuestion{ID: uuid.NewString(), Header: pick("header", "title"), Question: pick("question", "prompt"), IsOther: true, Options: []ProviderOption{}}
		if q.Header == "" {
			q.Header = "Question"
		}
		q.MultiSelect, _ = row["multiSelect"].(bool)
		if alternate, ok := row["multi_select"].(bool); ok {
			q.MultiSelect = alternate
		}
		if options, ok := row["options"].([]any); ok {
			for _, option := range options {
				item := ProviderOption{}
				switch value := option.(type) {
				case string:
					item.Label = value
				case map[string]any:
					item.Label, _ = value["label"].(string)
					if item.Label == "" {
						item.Label, _ = value["value"].(string)
					}
					item.Description, _ = value["description"].(string)
				}
				q.Options = append(q.Options, item)
			}
		}
		questions = append(questions, q)
	}
	if !validProviderQuestions(questions) {
		return nil, nil, errors.New("invalid questions")
	}
	for _, q := range questions {
		if q.Question == "" {
			return nil, nil, errors.New("empty question")
		}
	}
	return questions, input, nil
}

func claudeQuestionMarker(q *ProviderRequest, status string) []byte {
	header := "Question"
	if len(q.Questions) > 0 && strings.TrimSpace(q.Questions[0].Header) != "" {
		header = q.Questions[0].Header
	}
	encoded, _ := json.Marshal(map[string]string{"type": "openade.question", "id": q.ID, "header": header, "status": status})
	return append(encoded, '\n')
}

func (s *claudeSubagents) emit(value []byte) {
	live := s.live
	if live == nil {
		return
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	if s.transcript != nil {
		_, _ = s.transcript.Write(value)
	}
	live.scrollback = append(live.scrollback, value...)
	if len(live.scrollback) > 256*1024 {
		live.scrollback = append([]byte(nil), live.scrollback[len(live.scrollback)-128*1024:]...)
	}
	for subscriber := range live.subscribers {
		select {
		case subscriber <- value:
		default:
			delete(live.subscribers, subscriber)
			close(subscriber)
		}
	}
}

func (s *claudeSubagents) providerRequests() []ProviderRequest {
	s.requestsMu.Lock()
	defer s.requestsMu.Unlock()
	requests := make([]ProviderRequest, 0, len(s.requests))
	for _, pending := range s.requests {
		requests = append(requests, *pending.request)
	}
	return requests
}

func (s *claudeSubagents) reply(id string, body providerReply) error {
	s.requestsMu.Lock()
	pending := s.requests[id]
	if pending == nil || body.Generation != s.generation {
		s.requestsMu.Unlock()
		return errors.New("this request is no longer active")
	}
	if len(body.Answers) != len(pending.request.Questions) {
		s.requestsMu.Unlock()
		return errors.New("answer every question")
	}
	answers := make(map[string]any, len(pending.request.Questions))
	for _, question := range pending.request.Questions {
		values := body.Answers[question.ID]
		if len(values) == 0 || (!question.MultiSelect && len(values) != 1) || len(values) > 12 {
			s.requestsMu.Unlock()
			return errors.New("answer every question")
		}
		for _, value := range values {
			if strings.TrimSpace(value) == "" || len(value) > 65536 {
				s.requestsMu.Unlock()
				return errors.New("answer every question")
			}
		}
		if question.MultiSelect {
			answers[question.Question] = values
		} else {
			answers[question.Question] = values[0]
		}
	}
	updated := make(map[string]any, len(pending.input)+1)
	for key, value := range pending.input {
		updated[key] = value
	}
	updated["answers"] = answers
	wireID := pending.wireID
	if err := s.controlResponse(wireID, map[string]any{"behavior": "allow", "updatedInput": updated}); err != nil {
		s.requestsMu.Unlock()
		return fmt.Errorf("Claude disconnected before receiving the answer: %w", err)
	}
	delete(s.requests, id)
	remaining := len(s.requests)
	s.requestsMu.Unlock()
	s.emit(claudeQuestionMarker(pending.request, "answered"))
	if remaining == 0 {
		_ = s.store.updateGeneration(s.sessionID, s.generation, "running", s.pid, nil)
	}
	return nil
}

func (s *claudeSubagents) dismissQuestions() {
	s.requestsMu.Lock()
	requests := s.requests
	s.requests = map[string]*claudePendingQuestion{}
	s.requestsMu.Unlock()
	for _, pending := range requests {
		s.emit(claudeQuestionMarker(pending.request, "dismissed"))
	}
}

func (m *SessionManager) claudeClient(id string) *claudeSubagents {
	live, err := m.getLive(id)
	if err != nil {
		return nil
	}
	return live.claude
}
