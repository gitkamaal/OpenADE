package daemon

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

type directoryAccess struct {
	Root     string `json:"root"`
	Bookmark string `json:"bookmark"`
}

func (d *Daemon) handleDirectoryAccess(w http.ResponseWriter, r *http.Request) {
	var access directoryAccess
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&access); err != nil {
		writeError(w, 400, err)
		return
	}
	if !filepath.IsAbs(access.Root) || access.Bookmark == "" {
		writeError(w, 400, fmt.Errorf("a selected folder and its macOS bookmark are required"))
		return
	}
	access.Root = filepath.Clean(access.Root)
	if err := grantDirectory(access.Bookmark, access.Root); err != nil {
		writeError(w, 403, err)
		return
	}
	folder := filepath.Join(d.config.DataDir, "repository-access")
	if err := os.MkdirAll(folder, 0700); err != nil {
		writeError(w, 500, err)
		return
	}
	hash := sha256.Sum256([]byte(access.Root))
	value, _ := json.Marshal(access)
	if err := os.WriteFile(filepath.Join(folder, hex.EncodeToString(hash[:])+".json"), value, 0600); err != nil {
		writeError(w, 500, err)
		return
	}
	w.WriteHeader(204)
}
func restoreDirectoryAccess(dataDir string) {
	folder := filepath.Join(dataDir, "repository-access")
	entries, _ := os.ReadDir(folder)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		value, err := os.ReadFile(filepath.Join(folder, entry.Name()))
		if err != nil || len(value) > 256*1024 {
			continue
		}
		var access directoryAccess
		if json.Unmarshal(value, &access) == nil && filepath.IsAbs(access.Root) {
			_ = grantDirectory(access.Bookmark, filepath.Clean(access.Root))
		}
	}
}

func (d *Daemon) handleDirectoryAccessStatus(w http.ResponseWriter, r *http.Request) {
	root := filepath.Clean(r.URL.Query().Get("root"))
	allowed := false
	if filepath.IsAbs(root) {
		hash := sha256.Sum256([]byte(root))
		file := filepath.Join(d.config.DataDir, "repository-access", hex.EncodeToString(hash[:])+".json")
		value, err := os.ReadFile(file)
		if err == nil && len(value) <= 256*1024 {
			var access directoryAccess
			if json.Unmarshal(value, &access) == nil && access.Root == root {
				allowed = grantDirectory(access.Bookmark, root) == nil
			}
		}
	}
	writeJSON(w, 200, map[string]bool{"allowed": allowed})
}
