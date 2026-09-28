//go:build darwin

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// RevealThemeSource accepts a library id, then asks the authenticated daemon
// for the exact persisted source path. The webview therefore cannot choose an
// arbitrary path for Finder. `open` receives an argument vector, never a shell
// command, so filenames cannot become command syntax.
func (a *App) RevealThemeSource(id string) error {
	if a.ctx == nil {
		return fmt.Errorf("desktop window is not ready")
	}
	if !strings.HasPrefix(id, "custom-") || len(id) > 128 {
		return fmt.Errorf("theme library id is invalid")
	}
	connection, err := a.EngineConnection()
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodGet, connection["url"]+"/api/themes", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+connection["token"])
	response, err := (&http.Client{Timeout: 4 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("load theme library: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("load theme library: %s", response.Status)
	}
	var library struct {
		Entries []struct {
			ID     string `json:"id"`
			Source struct {
				Kind string `json:"kind"`
				Path string `json:"path"`
			} `json:"source"`
		} `json:"entries"`
	}
	if err := json.NewDecoder(response.Body).Decode(&library); err != nil {
		return fmt.Errorf("decode theme library: %w", err)
	}
	path := ""
	for _, entry := range library.Entries {
		if entry.ID == id && (entry.Source.Kind == "linkedFile" || entry.Source.Kind == "linkedPackage" || entry.Source.Kind == "editableFile" || entry.Source.Kind == "snapshot") {
			path = entry.Source.Path
			break
		}
	}
	if !filepath.IsAbs(path) {
		return fmt.Errorf("theme source is not available to reveal")
	}
	path = filepath.Clean(path)
	if _, err := os.Lstat(path); err != nil {
		return fmt.Errorf("theme source is no longer available: %w", err)
	}
	return exec.Command("/usr/bin/open", "-R", path).Run()
}
