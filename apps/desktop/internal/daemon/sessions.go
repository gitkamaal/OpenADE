package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/google/uuid"
)

const maxScrollback = 2 * 1024 * 1024

type CreateSessionRequest struct {
	Model       string `json:"model"`
	Effort      string `json:"effort"`
	ServiceTier string `json:"service_tier"`
	Checkout    string `json:"checkout"`
	Title       string `json:"title"`
	Prompt      string `json:"prompt"`
	Agent       string `json:"agent"`
	Mode        string `json:"mode"`
	ResumeID    string `json:"resume_id"`
	RepoRoot    string `json:"repo_root"`
	BaseBranch  string `json:"base_branch"`
	TicketKey   string `json:"ticket_key"`
	TicketURL   string `json:"ticket_url"`
}

type liveSession struct {
	mu                sync.Mutex
	pty               *os.File
	cmd               *exec.Cmd
	scrollback        []byte
	subscribers       map[chan []byte]struct{}
	readDone          chan struct{}
	done              chan struct{}
	stopRequested     bool
	terminationReason string
	generation        int64
	turnID            string
	rawPTY            bool
}

type SessionManager struct {
	store     *Store
	dataDir   string
	mu        sync.RWMutex
	queueMu   sync.Mutex
	surfaceMu sync.Mutex
	launchMu  sync.Mutex
	live      map[string]*liveSession
}

func NewSessionManager(store *Store, dataDir string) *SessionManager {
	return &SessionManager{store: store, dataDir: dataDir, live: make(map[string]*liveSession)}
}

func (m *SessionManager) Create(ctx context.Context, request CreateSessionRequest) (Session, error) {
	if isClaudeAgent(request.Agent) && request.Effort == "ultra" {
		return Session{}, fmt.Errorf("unsupported Claude reasoning effort")
	}
	if err := validateModel(request.Model, request.Effort); err != nil {
		return Session{}, err
	}
	if err := validateServiceTier(request.Agent, request.ServiceTier); err != nil {
		return Session{}, err
	}
	if request.Checkout != "" && request.Checkout != "worktree" && request.Checkout != "current" {
		return Session{}, fmt.Errorf("unknown checkout mode")
	}
	request.Title = strings.TrimSpace(request.Title)
	request.RepoRoot = strings.TrimSpace(request.RepoRoot)
	request.Agent = strings.TrimSpace(request.Agent)
	if request.Title == "" || request.RepoRoot == "" {
		return Session{}, fmt.Errorf("title and repository are required")
	}
	if request.Agent == "" {
		request.Agent = "claude"
	}
	if request.Mode == "" {
		request.Mode = "chat"
	}
	if request.Mode != "chat" && request.Mode != "tui" {
		return Session{}, fmt.Errorf("session mode must be chat or tui")
	}
	if request.BaseBranch == "" {
		request.BaseBranch = "HEAD"
	}
	repo, err := verifyRepository(ctx, request.RepoRoot)
	gitProject := err == nil
	if !gitProject {
		repo, err = filepath.Abs(request.RepoRoot)
		if err != nil {
			return Session{}, err
		}
		repo, err = filepath.EvalSymlinks(repo)
		if err != nil {
			return Session{}, err
		}
		info, statErr := os.Stat(repo)
		if statErr != nil || !info.IsDir() || !plainProjectFolder(repo) {
			return Session{}, fmt.Errorf("choose an existing project folder")
		}
		if request.Checkout != "current" {
			return Session{}, fmt.Errorf("folders without Git use the current-folder checkout")
		}
		request.BaseBranch = ""
	}

	id := uuid.NewString()
	branch := makeBranch(request.TicketKey, request.Title, id)
	repoName := filepath.Base(repo)
	worktree := filepath.Join(m.dataDir, "worktrees", repoName, id)
	if !gitProject {
		worktree = repo
		branch = ""
	} else if request.Checkout == "current" {
		worktree = repo
		branch, err = gitOutput(ctx, repo, "branch", "--show-current")
		if err != nil {
			return Session{}, err
		}
		if branch == "" {
			branch = "HEAD"
		}
	} else {
		if err := os.MkdirAll(filepath.Dir(worktree), 0755); err != nil {
			return Session{}, err
		}
		if err := createWorktree(ctx, repo, worktree, branch, request.BaseBranch); err != nil {
			return Session{}, err
		}
	}

	now := time.Now().UTC()
	session := Session{ID: id, Title: request.Title, Prompt: request.Prompt, Agent: request.Agent, Mode: request.Mode,
		RepoRoot: repo, WorktreePath: worktree, Branch: branch, BaseBranch: request.BaseBranch,
		TicketKey: strings.ToUpper(strings.TrimSpace(request.TicketKey)), TicketURL: request.TicketURL,
		Status: "starting", CreatedAt: now, UpdatedAt: now, Model: request.Model, Effort: request.Effort, ServiceTier: request.ServiceTier}
	if err := m.store.CreateSession(session); err != nil {
		return Session{}, err
	}
	m.surfaceMu.Lock()
	defer m.surfaceMu.Unlock()
	var launchErr error
	if request.ResumeID != "" {
		launchErr = m.writeProviderSessionMarker(session, request.ResumeID)
		if launchErr == nil && request.Mode == "tui" {
			var program string
			var args []string
			program, args, launchErr = tuiProviderCommand(session, request.ResumeID)
			if launchErr == nil {
				launchErr = m.launchCommand(session, program, args)
			}
		} else if launchErr == nil {
			launchErr = m.store.UpdateRuntime(session.ID, "completed", 0, nil)
		}
	} else {
		launchErr = m.launch(session)
	}
	if launchErr != nil {
		_ = m.store.UpdateRuntime(id, "failed", 0, nil)
		return m.store.GetSession(id)
	}
	return m.store.GetSession(id)
}

func (m *SessionManager) writeProviderSessionMarker(session Session, providerID string) error {
	marker := map[string]string{"type": "openade.provider_session"}
	if strings.Contains(strings.ToLower(session.Agent), "codex") {
		marker["thread_id"] = providerID
	} else {
		marker["session_id"] = providerID
	}
	encoded, err := json.Marshal(marker)
	if err != nil {
		return err
	}
	transcriptDir := filepath.Join(m.dataDir, "transcripts")
	if err := os.MkdirAll(transcriptDir, 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(transcriptDir, session.ID+".log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	// PTY transcripts frequently end in an escape sequence rather than a
	// newline. Frame the marker as its own JSONL record in either case.
	record := append([]byte{'\n'}, encoded...)
	record = append(record, '\n')
	_, err = file.Write(record)
	if err == nil {
		_, err = m.store.db.Exec(`UPDATE sessions SET provider_session_id=? WHERE id=?`, providerID, session.ID)
	}
	return err
}

func tuiProviderCommand(session Session, providerID string) (string, []string, error) {
	agent := strings.ToLower(session.Agent)
	if mapped := map[string]string{"claude-code": "claude", "codex-cli": "codex"}[agent]; mapped != "" {
		agent = mapped
	}
	program, err := resolveProgram(agent)
	if err != nil {
		return "", nil, err
	}
	switch agent {
	case "codex":
		return program, []string{"resume", "--include-non-interactive", "--no-alt-screen", "-C", session.WorktreePath, providerID}, nil
	case "claude":
		return program, []string{"--resume", providerID, "--permission-mode", "acceptEdits"}, nil
	default:
		return "", nil, fmt.Errorf("conversation import is only supported for Codex and Claude Code")
	}
}

func (m *SessionManager) launch(session Session) error {
	if session.Mode == "tui" && isClaudeAgent(session.Agent) {
		// Claude's interactive output does not expose its provider session ID.
		// Give every new direct TUI a stable ID up front so chat/TUI switches can
		// resume the same conversation instead of relying on cwd-sensitive
		// --continue behavior.
		if err := m.writeProviderSessionMarker(session, session.ID); err != nil {
			return err
		}
	}
	program, args, err := agentCommand(session)
	if err != nil {
		return err
	}
	return m.launchCommand(session, program, args)
}

func (m *SessionManager) launchCommand(session Session, program string, args []string) error {
	m.launchMu.Lock()
	defer m.launchMu.Unlock()
	if _, err := m.getLive(session.ID); err == nil {
		return fmt.Errorf("session is already running")
	}
	startTree, _ := snapshotWorkingTree(context.Background(), session.WorktreePath)
	turnID, generation, err := m.store.BeginTurn(session.ID, session.Prompt, session.queueMessageID, startTree)
	if err != nil {
		return err
	}
	if providerCapabilities(session.Agent).NativeChat {
		args = append(providerOptions(session), args...)
	}
	cmd := exec.Command(program, args...)
	cmd.Dir = session.WorktreePath
	cmd.Env = processEnvironment("TERM=xterm-256color", "COLORTERM=truecolor", "OPENADE_SESSION_ID="+session.ID)
	var ptmx *os.File
	rawPTY := session.Mode == "tui" || !providerCapabilities(session.Agent).NativeChat
	if rawPTY {
		ptmx, err = pty.StartWithSize(cmd, &pty.Winsize{Rows: 42, Cols: 120})
	} else {
		var writer *os.File
		ptmx, writer, err = os.Pipe()
		if err == nil {
			cmd.Stdout = writer
			cmd.Stderr = writer
			cmd.Stdin = nil
			cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
			err = cmd.Start()
			_ = writer.Close()
		}
	}
	if err != nil {
		if ptmx != nil {
			_ = ptmx.Close()
		}
		_ = m.store.UpdateRuntime(session.ID, "failed", 0, nil)
		return fmt.Errorf("start %s: %w", session.Agent, err)
	}
	live := newLiveSession(ptmx, cmd)
	live.rawPTY = rawPTY
	live.generation = generation
	live.turnID = turnID
	if err := m.store.UpdateRuntime(session.ID, "running", cmd.Process.Pid, nil); err != nil {
		terminateUnmanagedProcess(live)
		return err
	}
	m.mu.Lock()
	m.live[session.ID] = live
	m.mu.Unlock()
	transcriptDir := filepath.Join(m.dataDir, "transcripts")
	_ = os.MkdirAll(transcriptDir, 0o755)
	transcript, _ := os.OpenFile(filepath.Join(transcriptDir, session.ID+".log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	go m.readOutput(session.ID, live, transcript)
	go m.wait(session.ID, live, transcript)
	return nil
}

func (m *SessionManager) Resume(session Session, prompt string) error {
	m.surfaceMu.Lock()
	defer m.surfaceMu.Unlock()
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return fmt.Errorf("message is required")
	}
	if _, err := m.getLive(session.ID); err == nil {
		return fmt.Errorf("session is already running")
	}
	transcriptPath := filepath.Join(m.dataDir, "transcripts", session.ID+".log")
	providerID := m.providerID(session)
	if providerID == "" && isClaudeAgent(session.Agent) {
		providerID = session.ID
		if err := m.writeProviderSessionMarker(session, providerID); err != nil {
			return err
		}
	}
	marker, _ := json.Marshal(map[string]string{"type": "openade.user_message", "text": prompt})
	file, err := os.OpenFile(transcriptPath, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(append(marker, '\n')); err != nil {
		_ = file.Close()
		return err
	}
	_ = file.Close()

	var program string
	var args []string
	if providerID == "" {
		fresh := session
		fresh.Prompt = prompt
		program, args, err = agentCommand(fresh)
	} else if needsFreshClaudeSession(session, providerID) {
		program, args, err = startClaudeAgentCommand(session, providerID, prompt)
	} else {
		program, args, err = resumeAgentCommand(session, providerID, prompt)
	}
	if err != nil {
		return err
	}
	session.Prompt = prompt
	return m.launchCommand(session, program, args)
}

func (m *SessionManager) SwitchSurface(session Session, mode string) error {
	m.surfaceMu.Lock()
	defer m.surfaceMu.Unlock()
	if mode != "chat" && mode != "tui" {
		return fmt.Errorf("session mode must be chat or tui")
	}
	agent := strings.ToLower(session.Agent)
	if agent != "codex" && agent != "codex-cli" && agent != "claude" && agent != "claude-code" {
		return fmt.Errorf("surface switching is only supported for Codex and Claude Code")
	}
	if session.Mode == mode {
		return nil
	}
	if live, err := m.getLive(session.ID); err == nil && live.cmd.Process != nil {
		if err := m.interrupt(live, "interrupted"); err != nil {
			return err
		}
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if _, err := m.getLive(session.ID); err != nil {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if _, err := m.getLive(session.ID); err == nil {
			return fmt.Errorf("timed out stopping the current %s surface", session.Mode)
		}
	}
	if err := m.store.UpdateMode(session.ID, mode); err != nil {
		return err
	}
	session.Mode = mode
	if mode == "chat" {
		go func() { _ = m.DrainQueue(session.ID) }()
		return nil
	}

	providerID := m.providerID(session)
	var program string
	var args []string
	var err error
	if providerID == "" || needsFreshClaudeSession(session, providerID) {
		if isClaudeAgent(session.Agent) {
			providerID = session.ID
			if err = m.writeProviderSessionMarker(session, providerID); err != nil {
				return err
			}
		}
		program, args, err = tuiResumeCommand(session)
	} else {
		program, args, err = tuiProviderCommand(session, providerID)
	}
	if err == nil {
		err = m.launchCommand(session, program, args)
	}
	if err != nil {
		_ = m.store.UpdateRuntime(session.ID, "failed", 0, nil)
	}
	return err
}

func (m *SessionManager) ResumeTUI(session Session) error {
	m.surfaceMu.Lock()
	defer m.surfaceMu.Unlock()
	if session.Mode != "tui" {
		return fmt.Errorf("session is not a direct TUI run")
	}
	if _, err := m.getLive(session.ID); err == nil {
		return fmt.Errorf("session is already running")
	}
	providerID := m.providerID(session)
	var program string
	var args []string
	var err error
	if providerID != "" && !needsFreshClaudeSession(session, providerID) {
		program, args, err = tuiProviderCommand(session, providerID)
	} else {
		if isClaudeAgent(session.Agent) {
			if err = m.writeProviderSessionMarker(session, session.ID); err != nil {
				return err
			}
		}
		program, args, err = tuiResumeCommand(session)
	}
	if err != nil {
		return err
	}
	return m.launchCommand(session, program, args)
}

func resumeAgentCommand(session Session, providerID, prompt string) (string, []string, error) {
	prompt = conversationPrompt(session, prompt)
	agent := strings.ToLower(session.Agent)
	name := map[string]string{"claude-code": "claude", "codex-cli": "codex"}[agent]
	if name == "" {
		name = agent
	}
	program, err := resolveProgram(name)
	if err != nil {
		return "", nil, err
	}
	switch name {
	case "claude":
		return program, []string{"--resume", providerID, "--print", "--verbose", "--output-format", "stream-json", "--include-partial-messages", "--permission-mode", "acceptEdits", prompt}, nil
	case "codex":
		return program, codexExecArgs(session, providerID, prompt), nil
	default:
		return "", nil, fmt.Errorf("follow-up messages are not supported for %s", session.Agent)
	}
}

func startClaudeAgentCommand(session Session, providerID, prompt string) (string, []string, error) {
	prompt = conversationPrompt(session, prompt)
	program, err := resolveProgram("claude")
	if err != nil {
		return "", nil, err
	}
	return program, []string{"--session-id", providerID, "--print", "--verbose", "--output-format", "stream-json", "--include-partial-messages", "--permission-mode", "acceptEdits", prompt}, nil
}

// A provider identity belongs to the session. Read a bounded prefix once for
// legacy transcripts; subsequent turns never load the full transcript.
func (m *SessionManager) providerID(session Session) string {
	var id string
	_ = m.store.db.QueryRow(`SELECT provider_session_id FROM sessions WHERE id=?`, session.ID).Scan(&id)
	if id != "" {
		return id
	}
	file, err := os.Open(filepath.Join(m.dataDir, "transcripts", session.ID+".log"))
	if err != nil {
		return ""
	}
	defer file.Close()
	scanner := bufio.NewScanner(io.LimitReader(file, 2*1024*1024))
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		if id = providerSessionID(scanner.Bytes(), session.Agent); id != "" {
			_, _ = m.store.db.Exec(`UPDATE sessions SET provider_session_id=? WHERE id=?`, id, session.ID)
			return id
		}
	}
	return ""
}

func providerSessionID(transcript []byte, agent string) string {
	for _, rawLine := range strings.Split(strings.ReplaceAll(string(transcript), "\r", ""), "\n") {
		line := strings.TrimSpace(rawLine)
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var event map[string]any
		if json.Unmarshal([]byte(line), &event) != nil {
			continue
		}
		if strings.Contains(strings.ToLower(agent), "codex") {
			if id, ok := event["thread_id"].(string); ok && id != "" {
				return id
			}
		} else if id, ok := event["session_id"].(string); ok && id != "" {
			return id
		}
	}
	return ""
}

func agentCommand(session Session) (string, []string, error) {
	if providerCapabilities(session.Agent).NativeChat {
		session.Prompt = conversationPrompt(session, session.Prompt)
	}
	agent := strings.ToLower(session.Agent)
	if agent == "shell" {
		if strings.TrimSpace(session.Prompt) != "" {
			return "/bin/sh", []string{"-lc", session.Prompt}, nil
		}
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/zsh"
		}
		return shell, []string{"-l"}, nil
	}
	name := map[string]string{"claude-code": "claude", "codex-cli": "codex", "github-copilot": "copilot"}[agent]
	if name == "" {
		name = agent
	}
	program, err := resolveProgram(name)
	if err != nil {
		return "", nil, err
	}
	if session.Mode == "tui" {
		switch name {
		case "codex":
			args := []string{"--no-alt-screen", "-C", session.WorktreePath}
			if session.Prompt != "" {
				args = append(args, session.Prompt)
			}
			return program, args, nil
		case "claude":
			args := []string{"--session-id", session.ID, "--permission-mode", "acceptEdits"}
			if session.Prompt != "" {
				args = append(args, session.Prompt)
			}
			return program, args, nil
		default:
			if session.Prompt != "" {
				return program, []string{session.Prompt}, nil
			}
			return program, nil, nil
		}
	}
	switch name {
	case "copilot":
		if session.Prompt != "" {
			return program, []string{"-p", session.Prompt}, nil
		}
	case "opencode":
		if session.Prompt != "" {
			return program, []string{"--prompt", session.Prompt}, nil
		}
	case "claude":
		if session.Prompt != "" {
			return program, []string{"--name", session.Title, "--print", "--verbose", "--output-format", "stream-json", "--include-partial-messages", "--permission-mode", "acceptEdits", session.Prompt}, nil
		}
		return program, []string{"--name", session.Title}, nil
	case "codex":
		if session.Prompt != "" {
			// Codex reads stdin in exec mode even with a prompt. Keep stdout on the
			// PTY for live events while closing only stdin so the run can begin.
			return program, codexExecArgs(session, "", session.Prompt), nil
		}
	default:
		if session.Prompt != "" {
			return program, []string{session.Prompt}, nil
		}
	}
	return program, nil, nil
}

func tuiResumeCommand(session Session) (string, []string, error) {
	agent := strings.ToLower(session.Agent)
	agent = map[string]string{"claude-code": "claude", "codex-cli": "codex"}[agent]
	if agent == "" {
		agent = strings.ToLower(session.Agent)
	}
	program, err := resolveProgram(agent)
	if err != nil {
		return "", nil, err
	}
	switch agent {
	case "codex":
		return program, []string{"--no-alt-screen", "-C", session.WorktreePath}, nil
	case "claude":
		return program, []string{"--session-id", session.ID, "--permission-mode", "acceptEdits"}, nil
	default:
		return "", nil, fmt.Errorf("direct TUI mode is only supported for Codex and Claude Code")
	}
}

func isClaudeAgent(agent string) bool {
	agent = strings.ToLower(agent)
	return agent == "claude" || agent == "claude-code"
}

func needsFreshClaudeSession(session Session, providerID string) bool {
	if !isClaudeAgent(session.Agent) || providerID == "" || providerID != session.ID {
		return false
	}
	configDir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR"))
	if configDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return false
		}
		configDir = filepath.Join(home, ".claude")
	}
	matches, err := filepath.Glob(filepath.Join(configDir, "projects", "*", providerID+".jsonl"))
	return err == nil && len(matches) == 0
}

func resolveProgram(name string) (string, error) {
	if name == "shell" {
		return "/bin/sh", nil
	}
	if path, err := exec.LookPath(name); err == nil {
		return path, nil
	}
	home, _ := os.UserHomeDir()
	for _, candidate := range []string{filepath.Join(home, ".local", "bin", name),
		filepath.Join(home, ".grok", "bin", name), filepath.Join("/opt/homebrew/bin", name), filepath.Join("/usr/local/bin", name)} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("%s CLI was not found; install it or add it to PATH", name)
}

func (m *SessionManager) readOutput(id string, live *liveSession, transcript *os.File) {
	defer close(live.readDone)
	reader := bufio.NewReaderSize(live.pty, 32*1024)
	buf := make([]byte, 8192)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			live.mu.Lock()
			if transcript != nil {
				_, _ = transcript.Write(chunk)
			}
			live.scrollback = append(live.scrollback, chunk...)
			if len(live.scrollback) > 256*1024 {
				copy(live.scrollback, live.scrollback[len(live.scrollback)-128*1024:])
				live.scrollback = live.scrollback[:128*1024]
			}

			for subscriber := range live.subscribers {
				select {
				case subscriber <- chunk:
				default:
					delete(live.subscribers, subscriber)
					close(subscriber)
				}
			}
			live.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

func (m *SessionManager) wait(id string, live *liveSession, transcript *os.File) {
	err := live.cmd.Wait()
	// The agent may have left background children in its process group. Once the
	// group leader exits, terminate any stragglers before releasing the PTY.
	_ = signalProcessGroup(live, syscall.SIGTERM)
	if live.rawPTY {
		_ = live.pty.Close()
		<-live.readDone
	} else {
		<-live.readDone
		_ = live.pty.Close()
	}
	code := 0
	status := "completed"
	if err != nil {
		status = "failed"
		if exitErr, ok := err.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		} else {
			code = 1
		}
	}
	live.mu.Lock()
	if live.stopRequested {
		status = live.terminationReason
		if status == "" {
			status = "stopped"
		}
	}
	live.mu.Unlock()
	m.mu.Lock()
	if m.live[id] == live {
		_ = m.store.updateGeneration(id, live.generation, status, 0, &code)
		delete(m.live, id)
	}
	m.mu.Unlock()
	if transcript != nil {
		_ = transcript.Close()
	}
	if session, err := m.store.GetSession(id); err == nil {
		_ = m.providerID(session)
	}
	live.mu.Lock()
	for subscriber := range live.subscribers {
		close(subscriber)
	}
	live.subscribers = make(map[chan []byte]struct{})
	live.mu.Unlock()
	close(live.done)
	if status == "completed" {
		go func() { _ = m.DrainQueue(id) }()
	}
}

func (m *SessionManager) DrainQueue(id string) error {
	m.queueMu.Lock()
	defer m.queueMu.Unlock()
	if _, err := m.getLive(id); err == nil {
		return nil
	}
	session, err := m.store.GetSession(id)
	if err != nil {
		return err
	}
	if session.Mode != "chat" || session.Agent == "shell" {
		return nil
	}
	message, err := m.store.ClaimNextQueuedMessage(id)
	if IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	session.queueMessageID = message.ID
	if err := m.Resume(session, message.Text); err != nil {
		_ = m.store.ReleaseQueuedMessage(message.ID)
		return err
	}
	return m.store.CompleteQueuedMessage(message.ID)
}

func (m *SessionManager) DrainAllQueues() {
	sessions, err := m.store.ListSessions()
	if err != nil {
		return
	}
	for _, session := range sessions {
		if session.Status == "stopped" {
			continue
		}
		_ = m.DrainQueue(session.ID)
	}
}

func (m *SessionManager) Write(id, data string) error {
	live, err := m.getLive(id)
	if err != nil {
		return err
	}
	if !live.rawPTY {
		return fmt.Errorf("native chat input uses the message queue")
	}
	_, err = io.WriteString(live.pty, data)
	return err
}

func (m *SessionManager) Resize(id string, rows, cols uint16) error {
	live, err := m.getLive(id)
	if err != nil {
		return err
	}
	if !live.rawPTY {
		return fmt.Errorf("native chat has no PTY to resize")
	}
	return pty.Setsize(live.pty, &pty.Winsize{Rows: rows, Cols: cols})
}

func (m *SessionManager) Stop(id string) error {
	live, err := m.getLive(id)
	if err != nil {
		return err
	}
	if live.cmd.Process == nil {
		return nil
	}
	return m.interrupt(live, "stopped")
}

func (m *SessionManager) interrupt(live *liveSession, reason string) error {
	live.mu.Lock()
	live.stopRequested = true
	live.terminationReason = reason
	live.mu.Unlock()
	return stopProcessGroup(live)
}

func stopProcessGroup(live *liveSession) error {
	if err := signalProcessGroup(live, syscall.SIGTERM); err != nil {
		return err
	}
	go func() {
		timer := time.NewTimer(time.Second)
		defer timer.Stop()
		select {
		case <-live.done:
			return
		case <-timer.C:
			if live.cmd.Process != nil {
				_ = signalProcessGroup(live, syscall.SIGKILL)
			}
		}
	}()
	return nil
}

func (m *SessionManager) Shutdown(ctx context.Context) {
	m.mu.RLock()
	lives := make([]*liveSession, 0, len(m.live))
	for _, live := range m.live {
		live.mu.Lock()
		live.stopRequested = true
		live.terminationReason = "interrupted"
		live.mu.Unlock()
		lives = append(lives, live)
	}
	m.mu.RUnlock()
	shutdownLiveProcesses(ctx, lives)
}

func (m *SessionManager) Subscribe(id string, after int64) (Replay, <-chan []byte, func(), error) {
	live, err := m.getLive(id)
	if err != nil {
		transcript, readErr := readReplay(filepath.Join(m.dataDir, "transcripts", id+".log"), after)
		if readErr != nil {
			return Replay{}, nil, nil, err
		}
		closed := make(chan []byte)
		close(closed)
		return transcript, closed, func() {}, nil
	}
	ch := make(chan []byte, 128)
	live.mu.Lock()
	initial, readErr := readReplay(filepath.Join(m.dataDir, "transcripts", id+".log"), after)
	if readErr != nil {
		initial = Replay{Data: append([]byte(nil), live.scrollback...), Reset: true}
		initial.Cursor = int64(len(initial.Data))
	}
	live.subscribers[ch] = struct{}{}
	live.mu.Unlock()
	cancel := func() {
		live.mu.Lock()
		if _, ok := live.subscribers[ch]; ok {
			delete(live.subscribers, ch)
			close(ch)
		}
		live.mu.Unlock()
	}
	return initial, ch, cancel, nil
}

func (m *SessionManager) getLive(id string) (*liveSession, error) {
	m.mu.RLock()
	live := m.live[id]
	m.mu.RUnlock()
	if live == nil {
		return nil, fmt.Errorf("session %s is not running", id)
	}
	return live, nil
}

func newLiveSession(ptmx *os.File, cmd *exec.Cmd) *liveSession {
	return &liveSession{
		pty:         ptmx,
		rawPTY:      true,
		cmd:         cmd,
		subscribers: make(map[chan []byte]struct{}),
		readDone:    make(chan struct{}),
		done:        make(chan struct{}),
	}
}

func terminateUnmanagedProcess(live *liveSession) {
	_ = signalProcessGroup(live, syscall.SIGKILL)
	_ = live.pty.Close()
	_ = live.cmd.Wait()
}

func signalProcessGroup(live *liveSession, signal syscall.Signal) error {
	if live == nil || live.cmd == nil || live.cmd.Process == nil {
		return nil
	}
	err := syscall.Kill(-live.cmd.Process.Pid, signal)
	if err == nil || errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return live.cmd.Process.Signal(signal)
}

func shutdownLiveProcesses(ctx context.Context, lives []*liveSession) {
	for _, live := range lives {
		_ = signalProcessGroup(live, syscall.SIGTERM)
	}
	if waitForLiveProcesses(ctx, lives) {
		return
	}
	for _, live := range lives {
		select {
		case <-live.done:
		default:
			_ = signalProcessGroup(live, syscall.SIGKILL)
		}
	}
	forceCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = waitForLiveProcesses(forceCtx, lives)
}

func waitForLiveProcesses(ctx context.Context, lives []*liveSession) bool {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		allDone := true
		for _, live := range lives {
			select {
			case <-live.done:
			default:
				allDone = false
			}
		}
		if allDone {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-ticker.C:
		}
	}
}

func conversationPrompt(session Session, prompt string) string {
	if strings.TrimSpace(session.Instructions) == "" || strings.TrimSpace(prompt) == "" {
		return prompt
	}
	return "Conversation instructions:\n" + session.Instructions + "\n\nUser message:\n" + prompt
}

func codexExecArgs(session Session, providerID, prompt string) []string {
	args := []string{"exec", "--json", "--sandbox", "workspace-write"}
	if session.Branch == "" {
		args = append(args, "--skip-git-repo-check")
	}
	if providerID != "" {
		args = append(args, "resume", providerID)
	}
	return append(args, prompt)
}
