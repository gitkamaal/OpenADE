package daemon

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// An empty harness follows the chat provider; an empty model selects its
// smallest advertised model. These settings belong to the local daemon profile.
type TitleSettings struct {
	Harness string `json:"harness"`
	Model   string `json:"model"`
}

func (s *Store) GetTitleSettings() (TitleSettings, error) {
	var settings TitleSettings
	err := s.db.QueryRow(`SELECT harness,model FROM title_settings WHERE id=1`).Scan(&settings.Harness, &settings.Model)
	if err == sql.ErrNoRows {
		return TitleSettings{}, nil
	}
	return settings, err
}

func (s *Store) SetTitleSettings(settings TitleSettings) error {
	settings.Harness = strings.TrimSpace(strings.ToLower(settings.Harness))
	settings.Model = strings.TrimSpace(settings.Model)
	if settings.Harness != "" && settings.Harness != "codex" && settings.Harness != "claude" {
		return fmt.Errorf("choose Codex or Claude Code for thread naming")
	}
	if settings.Harness == "" && settings.Model != "" {
		return fmt.Errorf("choose a naming provider before its model")
	}
	if len(settings.Model) > 120 || strings.ContainsAny(settings.Model, "\r\n\x00") {
		return fmt.Errorf("invalid naming model")
	}
	if settings.Harness != "" {
		if _, err := resolveProgram(settings.Harness); err != nil {
			return fmt.Errorf("install the selected naming provider first: %w", err)
		}
	}
	_, err := s.db.Exec(`INSERT INTO title_settings(id,harness,model) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET harness=excluded.harness,model=excluded.model`, settings.Harness, settings.Model)
	return err
}

func (d *Daemon) handleTitleSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		settings, err := d.store.GetTitleSettings()
		if err != nil {
			writeError(w, 500, err)
			return
		}
		writeJSON(w, 200, settings)
		return
	}
	var settings TitleSettings
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&settings); err != nil {
		writeError(w, 400, err)
		return
	}
	if err := d.store.SetTitleSettings(settings); err != nil {
		writeError(w, 400, err)
		return
	}
	settings, err := d.store.GetTitleSettings()
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, settings)
}
