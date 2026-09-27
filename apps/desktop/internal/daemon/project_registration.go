package daemon

import (
	"context"
	"encoding/json"
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
	if _, err = d.store.db.Exec(`INSERT INTO registered_projects(path) VALUES(?) ON CONFLICT(path) DO NOTHING`, path); err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 201, map[string]any{"path": path})
}
