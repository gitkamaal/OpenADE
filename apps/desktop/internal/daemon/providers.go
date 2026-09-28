package daemon

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"time"
)

// Capabilities describe this adapter implementation, not every upstream feature.
// Unsupported steering is queue-and-resume, never simulated process input.
type ProviderCapabilities struct {
	NativeChat      bool   `json:"native_chat"`
	DirectTUI       bool   `json:"direct_tui"`
	Resume          bool   `json:"resume"`
	PersistentTurns bool   `json:"persistent_turns"`
	Interrupt       bool   `json:"interrupt"`
	MidTurnSteering bool   `json:"mid_turn_steering"`
	Permissions     bool   `json:"permissions"`
	Usage           bool   `json:"usage"`
	Transport       string `json:"transport"`
}

func providerCapabilities(agent string) ProviderCapabilities {
	if isACPAgent(agent) {
		return ProviderCapabilities{NativeChat: true, Resume: true, PersistentTurns: true, Interrupt: true, Permissions: true, Usage: true, Transport: "acp-stdio"}
	}
	switch agent {
	case "claude", "claude-code", "codex", "codex-cli":
		return ProviderCapabilities{NativeChat: true, DirectTUI: true, Resume: true, Interrupt: true, Transport: "structured-pipe"}
	case "shell":
		return ProviderCapabilities{DirectTUI: true, Interrupt: true, Transport: "raw-pty"}
	default:
		return ProviderCapabilities{DirectTUI: true, Interrupt: true, Transport: "raw-pty"}
	}
}

type ServiceTierChoice struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}
type ModelChoice struct {
	ServiceTiers []ServiceTierChoice `json:"service_tiers,omitempty"`
	ID           string              `json:"id"`
	Label        string              `json:"label"`
	Description  string              `json:"description"`
	Efforts      []string            `json:"efforts"`
}

func providerModels(agent string) []ModelChoice {
	if agent == "claude" {
		return []ModelChoice{{ID: "sonnet", Label: "Sonnet", Efforts: []string{"low", "medium", "high", "xhigh", "max"}}, {ID: "opus", Label: "Opus", Efforts: []string{"low", "medium", "high", "xhigh", "max"}}, {ID: "fable", Label: "Fable", Efforts: []string{"low", "medium", "high", "xhigh", "max"}}}
	}
	if agent != "codex" {
		return []ModelChoice{}
	}
	// A cache is optional. Filesystem privacy prompts or mounted volumes must
	// not hold metadata loading (and window connection) indefinitely. Bound
	// outstanding reads as well as caller latency; timed-out I/O cannot be
	// forcibly cancelled by Go and retains its slot until it finishes.
	select {
	case modelCacheReaders <- struct{}{}:
	default:
		return []ModelChoice{}
	}
	result := make(chan []ModelChoice, 1)
	go func() {
		defer func() { <-modelCacheReaders }()
		result <- readCodexModelCache()
	}()
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	select {
	case models := <-result:
		return models
	case <-timer.C:
		return []ModelChoice{}
	}
}

var modelCacheReaders = make(chan struct{}, 2)

func readCodexModelCache() []ModelChoice {
	path := filepath.Join(providerHome(), ".codex", "models_cache.json")
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 2*1024*1024 {
		return []ModelChoice{}
	}
	file, err := os.Open(path)
	if err != nil {
		return []ModelChoice{}
	}
	defer file.Close()
	var cache struct {
		Models []struct {
			Slug        string `json:"slug"`
			Name        string `json:"display_name"`
			Description string `json:"description"`
			Tiers       []struct {
				ID          string `json:"id"`
				Name        string `json:"name"`
				Description string `json:"description"`
			} `json:"service_tiers"`
			Levels []struct {
				Effort string `json:"effort"`
			} `json:"supported_reasoning_levels"`
		}
	}
	if json.NewDecoder(io.LimitReader(file, 2*1024*1024)).Decode(&cache) != nil {
		return []ModelChoice{}
	}
	models := []ModelChoice{}
	for _, model := range cache.Models {
		if !modelName.MatchString(model.Slug) {
			continue
		}
		efforts := []string{}
		for _, level := range model.Levels {
			efforts = append(efforts, level.Effort)
		}
		tiers := []ServiceTierChoice{}
		for _, tier := range model.Tiers {
			if tier.ID == "priority" {
				tiers = append(tiers, ServiceTierChoice{ID: tier.ID, Label: tier.Name, Description: tier.Description})
			}
		}
		models = append(models, ModelChoice{ServiceTiers: tiers, ID: model.Slug, Label: model.Name, Description: model.Description, Efforts: efforts})
		if len(models) == 64 {
			break
		}
	}
	return models
}

var modelName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$`)

func validateModel(model, effort string) error {
	if model != "" && !modelName.MatchString(model) {
		return fmt.Errorf("invalid model identifier")
	}
	if effort != "" && !slices.Contains([]string{"low", "medium", "high", "xhigh", "max", "ultra"}, effort) {
		return fmt.Errorf("invalid reasoning effort")
	}
	return nil
}
func providerOptions(session Session) []string {
	args := []string{}
	if session.Model != "" {
		args = append(args, "--model", session.Model)
	}
	if session.Effort != "" {
		if isClaudeAgent(session.Agent) {
			args = append(args, "--effort", session.Effort)
		} else {
			args = append(args, "-c", `model_reasoning_effort="`+session.Effort+`"`)
		}
	}
	if session.ServiceTier != "" && !isClaudeAgent(session.Agent) {
		args = append(args, "-c", `service_tier="`+session.ServiceTier+`"`)
	}
	return args
}
func validateServiceTier(agent, tier string) error {
	if tier == "" {
		return nil
	}
	if (agent != "codex" && agent != "codex-cli") || tier != "priority" {
		return fmt.Errorf("unsupported service tier")
	}
	return nil
}
func (d *Daemon) handleModel(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Model       string `json:"model"`
		Effort      string `json:"effort"`
		ServiceTier string `json:"service_tier"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, 400, err)
		return
	}
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if isACPAgent(session.Agent) {
		err = validateACPModel(input.Model, input.Effort)
	} else {
		err = validateModel(input.Model, input.Effort)
	}
	if err != nil {
		writeError(w, 400, err)
		return
	}
	if err = validateServiceTier(session.Agent, input.ServiceTier); err != nil {
		writeError(w, 400, err)
		return
	}
	if isACPAgent(session.Agent) {
		// An empty value means the agent's initial default, but ACP has no
		// generic reset RPC. Do not claim a reset while the live agent keeps
		// the previously selected wire value. Users can choose an advertised
		// default model or effort explicitly.
		if (session.Model != "" && input.Model == "") || (session.Effort != "" && input.Effort == "") {
			writeError(w, 409, fmt.Errorf("choose an advertised ACP model and effort to replace the current selection"))
			return
		}
		state, catalogErr := d.sessions.acpSelectionState(r.Context(), session, false)
		if catalogErr != nil {
			writeError(w, 502, catalogErr)
			return
		}
		if selectionErr := state.validateSelection(input.Model, input.Effort); selectionErr != nil {
			writeError(w, 409, selectionErr)
			return
		}
	}
	if isClaudeAgent(session.Agent) && input.Effort == "ultra" {
		writeError(w, 400, fmt.Errorf("unsupported Claude reasoning effort"))
		return
	}
	if !providerCapabilities(session.Agent).NativeChat {
		writeError(w, 409, fmt.Errorf("this provider uses its own model controls"))
		return
	}
	_, err = d.store.db.Exec(`UPDATE sessions SET model=?,effort=?,service_tier=?,updated_at=? WHERE id=?`, input.Model, input.Effort, input.ServiceTier, encodeTime(time.Now().UTC()), session.ID)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]string{"model": input.Model, "effort": input.Effort})
}
