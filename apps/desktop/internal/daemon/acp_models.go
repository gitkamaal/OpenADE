package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ACP v1 advertises model selection either as a category=model config option
// or as the older first-class models state. The wire values are authoritative:
// a picker value is never silently substituted with a provider default.
type acpSessionState struct {
	SessionID     string            `json:"sessionId"`
	ConfigOptions []acpConfigOption `json:"configOptions"`
	Models        acpModelState     `json:"models"`
}

type acpConfigOption struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Category     string          `json:"category"`
	Type         string          `json:"type"`
	CurrentValue json.RawMessage `json:"currentValue"`
	Options      json.RawMessage `json:"options"`
}

type acpModelState struct {
	CurrentModelID string `json:"currentModelId"`
	Available      []struct {
		ID          string `json:"modelId"`
		Name        string `json:"name"`
		Description string `json:"description"`
	} `json:"availableModels"`
}

type acpChoice struct {
	Value       string `json:"value"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

func acpChoices(raw json.RawMessage) []acpChoice {
	return acpChoicesAt(raw, 0)
}

func acpChoicesAt(raw json.RawMessage, depth int) []acpChoice {
	if depth > 3 {
		return nil
	}
	var values []json.RawMessage
	if json.Unmarshal(raw, &values) != nil {
		return nil
	}
	choices := make([]acpChoice, 0, len(values))
	for _, value := range values {
		if len(choices) >= 128 {
			break
		}
		var choice acpChoice
		if json.Unmarshal(value, &choice) == nil && choice.Value != "" {
			choices = append(choices, choice)
			continue
		}
		var group struct {
			Options json.RawMessage `json:"options"`
		}
		if json.Unmarshal(value, &group) == nil && len(group.Options) != 0 {
			choices = append(choices, acpChoicesAt(group.Options, depth+1)...)
		}
	}
	if len(choices) > 128 {
		choices = choices[:128]
	}
	return choices
}

func (s acpSessionState) option(category string) *acpConfigOption {
	for i := range s.ConfigOptions {
		option := &s.ConfigOptions[i]
		if option.Type == "select" && option.Category == category {
			return option
		}
	}
	return nil
}

func (s acpSessionState) modelChoices() []ModelChoice {
	efforts := []string{}
	if option := s.option("thought_level"); option != nil {
		for _, choice := range acpChoices(option.Options) {
			if validACPEffort(choice.Value) && !containsString(efforts, choice.Value) {
				efforts = append(efforts, choice.Value)
			}
		}
	}
	models := []ModelChoice{}
	seen := map[string]bool{}
	appendModel := func(id, label, description string) {
		if !modelName.MatchString(id) || seen[id] || len(models) >= 64 {
			return
		}
		seen[id] = true
		if label == "" {
			label = id
		}
		models = append(models, ModelChoice{ID: id, Label: label, Description: description, Efforts: append([]string{}, efforts...)})
	}
	if option := s.option("model"); option != nil {
		if option.ID == "" {
			return models
		}
		choices := acpChoices(option.Options)
		hasReal := false
		for _, choice := range choices {
			if choice.Value != "default" {
				hasReal = true
			}
		}
		for _, choice := range choices {
			if hasReal && choice.Value == "default" {
				continue
			}
			appendModel(choice.Value, choice.Name, choice.Description)
		}
		return models
	}
	for _, model := range s.Models.Available {
		appendModel(model.ID, model.Name, model.Description)
	}
	return models
}

func validACPEffort(value string) bool {
	switch value {
	case "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode", "ultrathink":
		return true
	default:
		return false
	}
}

func validateACPModel(model, effort string) error {
	if model != "" && !modelName.MatchString(model) {
		return fmt.Errorf("invalid model identifier")
	}
	if effort != "" && !validACPEffort(effort) {
		return fmt.Errorf("invalid ACP reasoning effort")
	}
	return nil
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

type acpSelectionOp struct {
	method   string
	params   map[string]any
	configID string
	value    string
}

func (s acpSessionState) modelOperation(sessionID, wanted string) (*acpSelectionOp, error) {
	if wanted == "" {
		return nil, nil
	}
	if option := s.option("model"); option != nil {
		if option.ID == "" {
			return nil, fmt.Errorf("the ACP agent advertised an invalid model control")
		}
		choices := acpChoices(option.Options)
		found := false
		for _, choice := range choices {
			if choice.Value == wanted {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("the ACP agent does not advertise model %q", wanted)
		}
		var current string
		_ = json.Unmarshal(option.CurrentValue, &current)
		if current == wanted {
			return nil, nil
		}
		return &acpSelectionOp{method: "session/set_config_option", params: map[string]any{"sessionId": sessionID, "configId": option.ID, "value": wanted}, configID: option.ID, value: wanted}, nil
	}
	if len(s.Models.Available) != 0 {
		for _, model := range s.Models.Available {
			if model.ID == wanted {
				if s.Models.CurrentModelID == wanted {
					return nil, nil
				}
				return &acpSelectionOp{method: "session/set_model", params: map[string]any{"sessionId": sessionID, "modelId": wanted}, value: wanted}, nil
			}
		}
		return nil, fmt.Errorf("the ACP agent does not advertise model %q", wanted)
	}
	return nil, fmt.Errorf("the ACP agent did not advertise selectable models")
}

func (s acpSessionState) effortOperation(sessionID, wanted string) (*acpSelectionOp, error) {
	if wanted == "" {
		return nil, nil
	}
	option := s.option("thought_level")
	if option == nil {
		return nil, fmt.Errorf("the ACP agent did not advertise reasoning effort controls")
	}
	if option.ID == "" {
		return nil, fmt.Errorf("the ACP agent advertised an invalid reasoning effort control")
	}
	found := false
	for _, choice := range acpChoices(option.Options) {
		if choice.Value == wanted {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("the ACP agent does not advertise reasoning effort %q", wanted)
	}
	var current string
	_ = json.Unmarshal(option.CurrentValue, &current)
	if current == wanted {
		return nil, nil
	}
	return &acpSelectionOp{method: "session/set_config_option", params: map[string]any{"sessionId": sessionID, "configId": option.ID, "value": wanted}, configID: option.ID, value: wanted}, nil
}

func (s acpSessionState) validateSelection(model, effort string) error {
	if _, err := s.modelOperation(s.SessionID, model); err != nil {
		return err
	}
	_, err := s.effortOperation(s.SessionID, effort)
	return err
}

func (c *acpConversation) applySelection(model, effort string) error {
	if model == "" && effort == "" {
		return nil
	}
	for _, kind := range []string{"model", "effort"} {
		c.mu.Lock()
		state, sessionID, closed := c.state, c.providerID, c.closed
		c.mu.Unlock()
		if closed {
			return fmt.Errorf("the ACP provider disconnected before model selection")
		}
		var operation *acpSelectionOp
		var err error
		if kind == "model" {
			operation, err = state.modelOperation(sessionID, model)
		} else {
			operation, err = state.effortOperation(sessionID, effort)
		}
		if err != nil {
			return err
		}
		if operation == nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		data, requestErr := c.rpc.request(ctx, operation.method, operation.params)
		cancel()
		if requestErr != nil {
			return fmt.Errorf("the ACP agent rejected %s selection: %w", kind, requestErr)
		}
		c.mu.Lock()
		if operation.method == "session/set_model" {
			c.state.Models.CurrentModelID = operation.value
		} else {
			var reply struct {
				ConfigOptions []acpConfigOption `json:"configOptions"`
			}
			if json.Unmarshal(data, &reply) == nil && reply.ConfigOptions != nil {
				c.state.ConfigOptions = reply.ConfigOptions
			} else {
				for i := range c.state.ConfigOptions {
					if c.state.ConfigOptions[i].ID == operation.configID {
						c.state.ConfigOptions[i].CurrentValue, _ = json.Marshal(operation.value)
						break
					}
				}
			}
		}
		c.mu.Unlock()
	}
	return nil
}

type acpCatalogEntry struct {
	state    acpSessionState
	identity string
	expires  time.Time
}

func (m *SessionManager) acpSelectionState(ctx context.Context, session Session, refresh bool) (acpSessionState, error) {
	if client := m.acpClient(session.ID); client != nil {
		client.mu.Lock()
		state, closed := client.state, client.closed
		client.mu.Unlock()
		if !closed && state.SessionID != "" {
			return state, nil
		}
	}
	return m.probeACPState(ctx, session.Agent, refresh)
}

func (m *SessionManager) probeACPState(ctx context.Context, agent string, refresh bool) (acpSessionState, error) {
	program, args, err := resolveACPProgram(agent)
	if err != nil {
		return acpSessionState{}, err
	}
	identity := program
	if info, statErr := os.Stat(program); statErr == nil {
		identity += "|" + strconv.FormatInt(info.Size(), 10) + "|" + strconv.FormatInt(info.ModTime().UnixNano(), 10)
	}
	m.acpCatalogMu.Lock()
	if entry, ok := m.acpCatalog[agent]; ok && !refresh && entry.identity == identity && time.Now().Before(entry.expires) {
		m.acpCatalogMu.Unlock()
		return entry.state, nil
	}
	m.acpCatalogMu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.TempDir()
	}
	probe := Session{ID: uuid.NewString(), Agent: agent, WorktreePath: home}
	rpc, err := startProviderRPC(program, args, probe, true)
	if err != nil {
		return acpSessionState{}, err
	}
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		for frame := range rpc.events {
			rpc.consume(frame)
			if len(frame.ID) > 0 {
				responseCtx, stop := context.WithTimeout(context.Background(), time.Second)
				_ = rpc.reject(responseCtx, frame.ID, -32601, "Unsupported during model discovery")
				stop()
			}
		}
	}()
	defer func() {
		rpc.stop()
		select {
		case <-rpc.processDone:
		case <-time.After(3 * time.Second):
		}
		<-drained
	}()
	capabilities := map[string]any{"fs": map[string]bool{"readTextFile": false, "writeTextFile": false}, "terminal": false}
	if strings.EqualFold(agent, "devin") {
		capabilities["_meta"] = map[string]bool{"cognition.ai/subagentSupport": true}
	}
	if _, err = rpc.request(ctx, "initialize", map[string]any{"protocolVersion": 1, "clientInfo": map[string]string{"name": "openade", "title": "OpenADE", "version": "0.4.0"}, "clientCapabilities": capabilities}); err != nil {
		return acpSessionState{}, fmt.Errorf("%s model discovery could not initialize", agent)
	}
	data, err := rpc.request(ctx, "session/new", map[string]any{"cwd": home, "mcpServers": []any{}})
	if err != nil {
		return acpSessionState{}, fmt.Errorf("%s model discovery could not open a session", agent)
	}
	var state acpSessionState
	if json.Unmarshal(data, &state) != nil || state.SessionID == "" {
		return acpSessionState{}, fmt.Errorf("%s model discovery returned invalid session data", agent)
	}
	m.acpCatalogMu.Lock()
	m.acpCatalog[agent] = acpCatalogEntry{state: state, identity: identity, expires: time.Now().Add(2 * time.Minute)}
	m.acpCatalogMu.Unlock()
	return state, nil
}

func (d *Daemon) handleACPModels(w http.ResponseWriter, r *http.Request) {
	agent := r.PathValue("agent")
	if agent == "cursor" {
		d.handleCursorModels(w, r)
		return
	}
	if !isACPAgent(agent) {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown ACP provider"))
		return
	}
	state, err := d.sessions.probeACPState(r.Context(), agent, r.URL.Query().Get("refresh") == "1")
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": state.modelChoices()})
}
