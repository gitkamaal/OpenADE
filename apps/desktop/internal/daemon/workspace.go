package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (d *Daemon) handleBranches(w http.ResponseWriter, r *http.Request) {
	root, err := verifyRepository(r.Context(), r.URL.Query().Get("root"))
	if err != nil {
		writeError(w, 400, err)
		return
	}
	output, err := gitOutput(r.Context(), root, "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes")
	if err != nil {
		writeError(w, 500, err)
		return
	}
	current, _ := gitOutput(r.Context(), root, "branch", "--show-current")
	branches := []string{}
	for _, branch := range strings.Split(output, "\n") {
		if branch != "" && !strings.HasSuffix(branch, "/HEAD") {
			branches = append(branches, branch)
		}
	}
	writeJSON(w, 200, map[string]any{"branches": branches, "current": current})
}
func localCommand(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out := boundedGitOutput{limit: 512 * 1024}
	cmd.Stdout = &out
	err := cmd.Run()
	if out.truncated {
		return "", fmt.Errorf("process discovery exceeded limit")
	}
	return out.String(), err
}
func (d *Daemon) handlePreviewServers(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	output, _ := localCommand(ctx, "lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn")
	pid := ""
	pids := map[string][]int{}
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, "p") {
			pid = strings.TrimPrefix(line, "p")
		} else if strings.HasPrefix(line, "n") && pid != "" {
			_, port, err := net.SplitHostPort(strings.TrimPrefix(line, "n"))
			if err == nil {
				number, _ := strconv.Atoi(port)
				if number > 0 {
					pids[pid] = append(pids[pid], number)
				}
			}
		}
	}
	ports := map[int]bool{}
	count := 0
	for pid, list := range pids {
		if count >= 64 {
			break
		}
		count++
		cwd, _ := localCommand(ctx, "lsof", "-a", "-p", pid, "-d", "cwd", "-Fn")
		for _, line := range strings.Split(cwd, "\n") {
			if strings.HasPrefix(line, "n") {
				root := strings.TrimPrefix(line, "n")
				if root == session.WorktreePath || strings.HasPrefix(root, session.WorktreePath+string(filepath.Separator)) {
					for _, port := range list {
						ports[port] = true
					}
				}
			}
		}
	}
	values := []int{}
	for port := range ports {
		values = append(values, port)
	}
	sort.Ints(values)
	urls := []string{}
	for _, port := range values {
		urls = append(urls, fmt.Sprintf("http://127.0.0.1:%d", port))
	}
	writeJSON(w, 200, map[string]any{"servers": urls})
}
func (d *Daemon) handleStage(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	var input struct {
		Path   string `json:"path"`
		Staged bool   `json:"staged"`
	}
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&input); err != nil {
		writeError(w, 400, err)
		return
	}
	clean := filepath.Clean(input.Path)
	if input.Path == "" || clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".git" || strings.HasPrefix(clean, ".git"+string(filepath.Separator)) {
		writeError(w, 400, fmt.Errorf("invalid workspace path"))
		return
	}
	// Literal pathspecs prevent a filename from broadening the staged selection.
	pathspec := ":(literal)" + filepath.ToSlash(clean)
	if input.Staged {
		_, err = gitOutput(r.Context(), session.WorktreePath, "add", "--", pathspec)
	} else {
		_, err = gitOutput(r.Context(), session.WorktreePath, "reset", "HEAD", "--", pathspec)
	}
	if err != nil {
		writeError(w, 409, err)
		return
	}
	w.WriteHeader(204)
}

func (d *Daemon) handleProviderSetup(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	args := map[string]string{"codex": "login", "claude": "auth login", "copilot": "login", "opencode": "auth login"}
	suffix, ok := args[provider]
	if !ok {
		writeError(w, 400, fmt.Errorf("use this provider's own sign-in controls"))
		return
	}
	program, err := resolveProgram(provider)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	d.providerSetupMu.Lock()
	defer d.providerSetupMu.Unlock()
	root := filepath.Join(d.sessions.dataDir, "provider-setup")
	if err = os.MkdirAll(root, 0700); err != nil {
		writeError(w, 500, err)
		return
	}
	if _, err = os.Stat(filepath.Join(root, ".git")); os.IsNotExist(err) {
		if _, err = gitOutput(r.Context(), root, "init", "-b", "main"); err == nil {
			_, err = gitOutput(r.Context(), root, "-c", "user.name=OpenADE", "-c", "user.email=openade@localhost", "commit", "--allow-empty", "-m", "Local provider setup")
		}
		if err != nil {
			writeError(w, 500, err)
			return
		}
	}
	command := "exec '" + strings.ReplaceAll(program, "'", "'\"'\"'") + "' " + suffix
	session, err := d.sessions.Create(r.Context(), CreateSessionRequest{Title: "Sign in to " + provider, Agent: "shell", Mode: "tui", Prompt: command, RepoRoot: root, BaseBranch: "main"})
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 201, session)
}

func (d *Daemon) handleSessionDetails(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Title        *string `json:"title"`
		Instructions *string `json:"instructions"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&input); err != nil {
		writeError(w, 400, err)
		return
	}
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if input.Title != nil {
		title := strings.TrimSpace(*input.Title)
		if title == "" || len(title) > 240 {
			writeError(w, 400, fmt.Errorf("chat title must contain 1–240 bytes"))
			return
		}
		session.Title = title
	}
	if input.Instructions != nil {
		if len(*input.Instructions) > 16*1024 {
			writeError(w, 400, fmt.Errorf("instructions exceed 16 KiB"))
			return
		}
		session.Instructions = *input.Instructions
	}
	_, err = d.store.db.Exec(`UPDATE sessions SET title=?,instructions=?,updated_at=? WHERE id=?`, session.Title, session.Instructions, encodeTime(time.Now().UTC()), session.ID)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	w.WriteHeader(204)
}
