package daemon

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const maxEditorBytes = 2 * 1024 * 1024

func editorPath(root *os.Root, path string) (string, error) {
	clean := filepath.Clean(path)
	if path == "" || strings.ContainsRune(path, 0) || filepath.IsAbs(path) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("file must be inside the project")
	}
	parts := strings.Split(clean, string(filepath.Separator))
	for i, part := range parts {
		if part == ".git" {
			return "", fmt.Errorf("Git metadata cannot be edited")
		}
		info, err := root.Lstat(filepath.Join(parts[:i+1]...))
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("symbolic links cannot be edited")
		}
	}
	return clean, nil
}
func readEditorFile(root *os.Root, path string) ([]byte, os.FileMode, error) {
	file, err := root.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, 0, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxEditorBytes {
		return nil, 0, fmt.Errorf("only regular text files up to 2 MiB can be edited")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxEditorBytes+1))
	if err != nil {
		return nil, 0, err
	}
	if len(data) > maxEditorBytes || bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return nil, 0, fmt.Errorf("file is binary or exceeds 2 MiB")
	}
	return data, info.Mode().Perm(), nil
}
func (d *Daemon) handleFile(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	root, err := os.OpenRoot(session.WorktreePath)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	defer root.Close()
	path, err := editorPath(root, r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, 400, err)
		return
	}
	data, mode, err := readEditorFile(root, path)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	if r.Method == http.MethodPut {
		var input struct {
			Content  string `json:"content"`
			Original string `json:"original"`
		}
		if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024*1024+1024)).Decode(&input); err != nil {
			writeError(w, 400, err)
			return
		}
		if len(input.Content) > maxEditorBytes || len(input.Original) > maxEditorBytes || strings.ContainsRune(input.Content, 0) || !utf8.ValidString(input.Content) {
			writeError(w, 400, fmt.Errorf("only text up to 2 MiB can be saved"))
			return
		}
		if string(data) != input.Original {
			writeError(w, 409, fmt.Errorf("this file changed on disk; reload it before saving"))
			return
		}
		temporary := filepath.Join(filepath.Dir(path), ".openade-edit-"+uuid.NewString())
		file, err := root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
		if err != nil {
			writeError(w, 500, err)
			return
		}
		defer root.Remove(temporary)
		if _, err = file.WriteString(input.Content); err == nil {
			err = file.Chmod(mode)
		}
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			writeError(w, 500, err)
			return
		}
		if _, err = editorPath(root, path); err != nil {
			writeError(w, 409, err)
			return
		}
		latest, _, err := readEditorFile(root, path)
		if err != nil || string(latest) != input.Original {
			writeError(w, 409, fmt.Errorf("this file changed on disk; reload it before saving"))
			return
		}
		if err = root.Rename(temporary, path); err != nil {
			writeError(w, 500, err)
			return
		}
		data = []byte(input.Content)
	}
	writeJSON(w, 200, map[string]any{"path": path, "content": string(data)})
}

type historyCommit struct {
	SHA     string `json:"sha"`
	Parents string `json:"parents"`
	Author  string `json:"author"`
	Date    string `json:"date"`
	Subject string `json:"subject"`
}

func (d *Daemon) handleHistory(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	output, err := gitOutput(r.Context(), session.WorktreePath, "log", "-n", "100", "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1e")
	if err != nil {
		writeError(w, 500, err)
		return
	}
	commits := []historyCommit{}
	for _, record := range strings.Split(output, "\x1e") {
		fields := strings.Split(strings.TrimSpace(record), "\x1f")
		if len(fields) == 5 {
			commits = append(commits, historyCommit{SHA: fields[0], Parents: fields[1], Author: fields[2], Date: fields[3], Subject: fields[4]})
		}
	}
	branch, _ := gitOutput(r.Context(), session.WorktreePath, "branch", "--show-current")
	if branch == "" {
		branch = "HEAD"
	}
	writeJSON(w, 200, map[string]any{"branch": branch, "commits": commits})
}
