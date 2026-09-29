package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
)

type claudeCatalogEntry struct {
	key     string
	expires time.Time
	models  []ModelChoice
}

// Claude's initialize control request advertises concrete model IDs without
// starting a model turn. Its response augments the pinned source fallback;
// an offline or older CLI must not make the model picker empty.
func (d *Daemon) handleClaudeModels(w http.ResponseWriter, r *http.Request) {
	models := providerModels("claude")
	program, err := resolveProgram("claude")
	if err == nil {
		key := program
		if info, statErr := os.Stat(program); statErr == nil {
			key = fmt.Sprintf("%s:%d:%d", program, info.Size(), info.ModTime().UnixNano())
		}
		d.sessions.claudeCatalogMu.Lock()
		cached := d.sessions.claudeCatalog
		if r.URL.Query().Get("refresh") != "1" && cached.key == key && time.Now().Before(cached.expires) {
			models = append([]ModelChoice(nil), cached.models...)
		} else {
			ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
			if discovered, probeErr := probeClaudeModels(ctx, program); probeErr == nil {
				models = overlayClaudeModels(models, discovered)
				d.sessions.claudeCatalog = claudeCatalogEntry{key: key, expires: time.Now().Add(time.Minute), models: append([]ModelChoice(nil), models...)}
			} else {
				d.sessions.claudeCatalog = claudeCatalogEntry{key: key, expires: time.Now().Add(10 * time.Second), models: append([]ModelChoice(nil), models...)}
			}
			cancel()
		}
		d.sessions.claudeCatalogMu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func probeClaudeModels(ctx context.Context, program string) ([]map[string]any, error) {
	cmd := exec.CommandContext(ctx, program, "--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	cmd.WaitDelay = 100 * time.Millisecond
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	defer func() {
		_ = stdin.Close()
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		_ = cmd.Wait()
	}()
	requestID := uuid.NewString()
	request, _ := json.Marshal(map[string]any{"type": "control_request", "request_id": requestID, "request": map[string]string{"subtype": "initialize"}})
	if _, err = stdin.Write(append(request, '\n')); err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(io.LimitReader(stdout, 2*1024*1024))
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		var frame struct {
			Type     string `json:"type"`
			Response struct {
				Subtype   string `json:"subtype"`
				RequestID string `json:"request_id"`
				Error     string `json:"error"`
				Response  struct {
					Models []map[string]any `json:"models"`
				} `json:"response"`
			} `json:"response"`
		}
		if json.Unmarshal(scanner.Bytes(), &frame) != nil || frame.Type != "control_response" || frame.Response.RequestID != requestID {
			continue
		}
		if frame.Response.Subtype != "success" {
			return nil, fmt.Errorf("Claude initialize failed")
		}
		return frame.Response.Response.Models, nil
	}
	if err = scanner.Err(); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("Claude did not advertise models")
}

func overlayClaudeModels(base []ModelChoice, discovered []map[string]any) []ModelChoice {
	models := append([]ModelChoice(nil), base...)
	seen := make(map[string]bool, len(models))
	for _, model := range models {
		seen[model.ID] = true
	}
	defaultID := ""
	for _, entry := range discovered {
		id, _ := entry["resolvedModel"].(string)
		if id == "" {
			id, _ = entry["value"].(string)
		}
		id = strings.TrimSpace(id)
		if !modelName.MatchString(id) || slices.Contains([]string{"default", "opus", "sonnet", "haiku", "fable"}, id) {
			continue
		}
		if value, _ := entry["value"].(string); value == "default" {
			defaultID = id
		}
		if seen[id] || len(models) >= 64 {
			continue
		}
		seen[id] = true
		label, _ := entry["displayName"].(string)
		label = strings.TrimSpace(label)
		if label == "" {
			label = id
		}
		description, _ := entry["description"].(string)
		efforts := []string{}
		if levels, ok := entry["supportedEffortLevels"].([]any); ok {
			for _, raw := range levels {
				level, _ := raw.(string)
				if slices.Contains([]string{"low", "medium", "high", "xhigh", "max"}, level) && !slices.Contains(efforts, level) {
					efforts = append(efforts, level)
				}
			}
		}
		models = append(models, ModelChoice{ID: id, Label: clipSubagentText(label, 100), Description: clipSubagentText(description, 240), Efforts: efforts})
	}
	if defaultID != "" {
		if index := slices.IndexFunc(models, func(model ModelChoice) bool { return model.ID == defaultID }); index > 0 {
			chosen := models[index]
			copy(models[1:index+1], models[:index])
			models[0] = chosen
		}
	}
	return models
}
