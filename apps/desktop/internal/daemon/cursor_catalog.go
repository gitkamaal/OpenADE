package daemon

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type cursorCatalogEntry struct {
	models   []ModelChoice
	identity string
	expires  time.Time
}

func cursorCatalogIdentity(program string) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte(program))
	_, _ = hash.Write([]byte(os.Getenv("CURSOR_API_KEY")))
	if info, err := os.Stat(program); err == nil {
		_, _ = hash.Write([]byte(fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano())))
	}
	if home, err := os.UserHomeDir(); err == nil {
		if info, err := os.Stat(filepath.Join(home, ".cursor", "sdk", "auth.json")); err == nil {
			_, _ = hash.Write([]byte(fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano())))
		}
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func (m *SessionManager) discoverCursorModels(ctx context.Context, refresh bool) ([]ModelChoice, error) {
	program, args, err := m.resolveCursorRuntime(ctx)
	if err != nil {
		return nil, err
	}
	identity := cursorCatalogIdentity(program)
	m.cursorCatalogMu.Lock()
	if !refresh && m.cursorCatalog.identity == identity && time.Now().Before(m.cursorCatalog.expires) {
		models := append([]ModelChoice{}, m.cursorCatalog.models...)
		m.cursorCatalogMu.Unlock()
		return models, nil
	}
	m.cursorCatalogMu.Unlock()
	probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, program, append(args, "models")...)
	cmd.Env = processEnvironment("OPENADE_CURSOR_STATE_DIR=" + cursorStateDir(m.dataDir))
	cmd.Stderr = nil
	cmd.WaitDelay = 2 * time.Second
	output := limitedOutput{limit: maxProviderFrameBytes + 1}
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		if probeCtx.Err() != nil {
			return nil, fmt.Errorf("Cursor model discovery timed out")
		}
		for _, line := range bytes.Split(output.data, []byte{'\n'}) {
			var frame cursorFrame
			if json.Unmarshal(line, &frame) == nil && frame.Event == "fatal" {
				return nil, fmt.Errorf("Cursor model discovery failed: %s", frame.Message)
			}
		}
		return nil, fmt.Errorf("Cursor model discovery failed: %w", err)
	}
	if len(output.data) > maxProviderFrameBytes {
		return nil, fmt.Errorf("Cursor model catalog exceeded its size limit")
	}
	for _, line := range bytes.Split(output.data, []byte{'\n'}) {
		var frame struct {
			Event string `json:"ev"`
			Items []struct {
				ID          string `json:"id"`
				DisplayName string `json:"displayName"`
				Description string `json:"description"`
			} `json:"items"`
		}
		if json.Unmarshal(line, &frame) != nil || frame.Event != "models" {
			continue
		}
		models := []ModelChoice{}
		seen := map[string]bool{}
		for _, item := range frame.Items {
			if item.ID == "default" || !modelName.MatchString(item.ID) || seen[item.ID] || len(models) >= 64 {
				continue
			}
			seen[item.ID] = true
			label := strings.TrimSpace(item.DisplayName)
			if label == "" {
				label = item.ID
			}
			if len(label) > 256 {
				label = label[:256]
			}
			description := strings.TrimSpace(item.Description)
			if len(description) > 512 {
				description = description[:512]
			}
			models = append(models, ModelChoice{ID: item.ID, Label: label, Description: description, Efforts: []string{}})
		}
		m.cursorCatalogMu.Lock()
		m.cursorCatalog = cursorCatalogEntry{models: models, identity: identity, expires: time.Now().Add(2 * time.Minute)}
		m.cursorCatalogMu.Unlock()
		return models, nil
	}
	return nil, fmt.Errorf("Cursor model discovery returned no catalog")
}

func (m *SessionManager) validateCursorSelection(ctx context.Context, model, effort string) error {
	if effort != "" {
		return fmt.Errorf("Cursor reasoning options must be chosen from its model catalog")
	}
	if model == "" {
		return nil
	}
	if !modelName.MatchString(model) {
		return fmt.Errorf("invalid Cursor model identifier")
	}
	models, err := m.discoverCursorModels(ctx, false)
	if err != nil {
		return err
	}
	for _, choice := range models {
		if choice.ID == model {
			return nil
		}
	}
	return fmt.Errorf("Cursor did not advertise model %q", model)
}

func (d *Daemon) handleCursorModels(w http.ResponseWriter, r *http.Request) {
	models, err := d.sessions.discoverCursorModels(r.Context(), r.URL.Query().Get("refresh") == "1")
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}
