package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type projectDirectory struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// Directory names only: file contents remain behind the session-scoped editor API.
func (d *Daemon) handleProjectDirectories(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, path[2:])
		}
	}
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			writeError(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"path": "", "parent": "", "entries": []projectDirectory{{"Home", home}, {"File system", string(filepath.Separator)}}})
		return
	}
	if !filepath.IsAbs(path) || strings.ContainsRune(path, 0) {
		writeError(w, 400, fmt.Errorf("choose an absolute folder path"))
		return
	}
	path = filepath.Clean(path)
	entries, err := d.readProjectDirectory(r.Context(), path)
	if err != nil {
		if err == context.DeadlineExceeded {
			writeError(w, http.StatusGatewayTimeout, fmt.Errorf("folder access timed out; use Browse folders to select it through the native folder chooser"))
			return
		}
		writeError(w, 400, fmt.Errorf("cannot open this folder: %w", err))
		return
	}
	folders := []projectDirectory{}
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			folders = append(folders, projectDirectory{entry.Name(), filepath.Join(path, entry.Name())})
			if len(folders) >= 1000 {
				break
			}
		}
	}
	_, gitErr := verifyRepository(r.Context(), path)
	writeJSON(w, 200, map[string]any{"path": path, "parent": filepath.Dir(path), "entries": folders, "git": gitErr == nil, "limited": len(folders) >= 1000})
}

// A filesystem open can block below Go's context handling (for example while
// macOS resolves folder access or a volume is unavailable). Bound both the HTTP
// wait and the number of outstanding filesystem operations; do not leave the
// picker spinning or create unlimited blocked OS threads.
func (d *Daemon) readProjectDirectory(ctx context.Context, path string) ([]os.DirEntry, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	select {
	case d.projectReads <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	type result struct {
		entries []os.DirEntry
		err     error
	}
	done := make(chan result, 1)
	go func() {
		defer func() { <-d.projectReads }()
		info, err := os.Stat(path)
		if err != nil {
			done <- result{err: err}
			return
		}
		if !info.IsDir() {
			done <- result{err: fmt.Errorf("choose an existing folder")}
			return
		}
		entries, err := os.ReadDir(path)
		done <- result{entries, err}
	}()
	select {
	case value := <-done:
		return value.entries, value.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (d *Daemon) handleRegisterProject(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&input); err != nil {
		writeError(w, 400, err)
		return
	}
	if !filepath.IsAbs(input.Path) || strings.ContainsRune(input.Path, 0) {
		writeError(w, 400, fmt.Errorf("choose an absolute folder path"))
		return
	}
	path, err := filepath.EvalSymlinks(filepath.Clean(input.Path))
	if err != nil {
		writeError(w, 400, err)
		return
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() || filepath.Base(path) == ".git" {
		writeError(w, 400, fmt.Errorf("choose an existing folder"))
		return
	}
	// Sessions use the Git top-level directory. Register that same identity so a
	// selected subfolder cannot leave a duplicate, empty project in the sidebar.
	if root, gitErr := verifyRepository(r.Context(), path); gitErr == nil {
		path = root
	} else if !plainProjectFolder(path) {
		writeError(w, 400, gitErr)
		return
	}
	d.projectMu.Lock()
	defer d.projectMu.Unlock()
	tx, err := d.store.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`INSERT INTO registered_projects(path) VALUES(?) ON CONFLICT(path) DO NOTHING`, path); err != nil {
		writeError(w, 500, err)
		return
	}
	if _, err = tx.Exec(`DELETE FROM removed_projects WHERE path=?`, path); err != nil {
		writeError(w, 500, err)
		return
	}
	if _, err = tx.Exec(`INSERT INTO activity(kind,entity_id,session_id,data) VALUES('catalog',?,'','{}')`, path); err != nil {
		writeError(w, 500, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 201, map[string]any{"path": path})
}

func (d *Daemon) handleRenameProject(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&input); err != nil {
		writeError(w, 400, err)
		return
	}
	input.Path = filepath.Clean(strings.TrimSpace(input.Path))
	input.Name = strings.TrimSpace(input.Name)
	if !filepath.IsAbs(input.Path) || strings.ContainsRune(input.Path, 0) || input.Name == "" || len([]rune(input.Name)) > 120 {
		writeError(w, 400, fmt.Errorf("project name must contain 1–120 characters"))
		return
	}
	if canonical, err := filepath.EvalSymlinks(input.Path); err == nil {
		input.Path = canonical
	} else {
		writeError(w, 400, fmt.Errorf("choose an existing project folder"))
		return
	}
	if info, err := os.Stat(input.Path); err != nil || !info.IsDir() {
		writeError(w, 400, fmt.Errorf("choose an existing project folder"))
		return
	}
	d.projectMu.Lock()
	defer d.projectMu.Unlock()
	removed, err := d.store.ProjectRemoved(input.Path)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	if removed {
		writeError(w, 409, fmt.Errorf("add this project again before renaming it"))
		return
	}
	known, err := d.store.ProjectKnown(input.Path)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	if !known {
		writeError(w, 404, fmt.Errorf("project is not registered"))
		return
	}
	if err := d.store.RenameProject(input.Path, input.Name); err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"path": input.Path, "name": input.Name})
}

func (d *Daemon) handleRemoveProject(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path       string   `json:"path"`
		SessionIDs []string `json:"session_ids"`
		Confirm    bool     `json:"confirm"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&input); err != nil {
		writeError(w, 400, err)
		return
	}
	input.Path = filepath.Clean(strings.TrimSpace(input.Path))
	if !input.Confirm || !filepath.IsAbs(input.Path) || strings.ContainsRune(input.Path, 0) {
		writeError(w, 400, fmt.Errorf("a confirmed absolute project path is required"))
		return
	}
	if canonical, err := filepath.EvalSymlinks(input.Path); err == nil {
		input.Path = canonical
	}
	d.projectMu.Lock()
	// Session creation and project registration use this same lock. Keep the
	// confirmed membership closed until teardown and the removal transaction
	// commit, so a failed stale confirmation cannot stop existing chats.
	defer d.projectMu.Unlock()
	known, err := d.store.ProjectKnown(input.Path)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	if !known {
		writeError(w, http.StatusNotFound, fmt.Errorf("project is not registered"))
		return
	}
	ids, err := d.store.ProjectSessions(input.Path)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	if len(ids) != len(input.SessionIDs) {
		writeError(w, http.StatusConflict, fmt.Errorf("project changed; review the current %d chats before removing", len(ids)))
		return
	}
	for i := range ids {
		if ids[i] != input.SessionIDs[i] {
			writeError(w, http.StatusConflict, fmt.Errorf("project changed; review the current chats before removing"))
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	release, err := d.deletions.begin(ctx, ids)
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	defer release()
	for _, id := range ids {
		if err := d.terminals.StopSession(id, 3*time.Second); err != nil {
			writeError(w, http.StatusConflict, fmt.Errorf("could not safely stop terminal for chat %s: %w", id, err))
			return
		}
		if err := d.sessions.StopAndRelease(id, 3*time.Second); err != nil {
			writeError(w, http.StatusConflict, fmt.Errorf("could not safely stop chat %s: %w", id, err))
			return
		}
	}
	if err := d.store.RemoveProject(input.Path, input.SessionIDs, d.config.DataDir); err != nil {
		var warning *CleanupWarning
		if errors.As(err, &warning) {
			writeJSON(w, 200, map[string]any{"path": input.Path, "removed_sessions": len(ids), "cleanup_warning": warning.Error()})
			return
		}
		if strings.Contains(err.Error(), "project changed") {
			writeError(w, http.StatusConflict, err)
		} else {
			writeError(w, 500, err)
		}
		return
	}
	writeJSON(w, 200, map[string]any{"path": input.Path, "removed_sessions": len(ids)})
}
