package daemon

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Config struct {
	Addr    string
	DataDir string
}

type Daemon struct {
	config          Config
	store           *Store
	sessions        *SessionManager
	terminals       *TerminalManager
	server          *http.Server
	listener        net.Listener
	releaseProfile  func()
	authToken       string
	providerSetupMu sync.Mutex
	attachmentMu    sync.Mutex
	artwork         *artworkStore
	themeLibrary    *ThemeLibrary
	projectReads    chan struct{}
	projectMu       sync.Mutex
	deletions       *deletionFence
}

func DefaultConfig() Config {
	dataDir := os.Getenv("OPENADE_DATA_DIR")
	if dataDir == "" {
		configDir, _ := os.UserConfigDir()
		dataDir = filepath.Join(configDir, "OpenADE")
		if profile := os.Getenv("OPENADE_PROFILE"); profile != "" && profile != "default" && profileName.MatchString(profile) {
			dataDir = filepath.Join(dataDir, "profiles", profile)
		}
	}
	addr := os.Getenv("OPENADE_DAEMON_ADDR")
	if addr == "" {
		addr = "127.0.0.1:7433"
	}
	return Config{Addr: addr, DataDir: dataDir}
}

func New(config Config) (*Daemon, error) {
	if config.Addr == "" {
		config.Addr = "127.0.0.1:7433"
	}
	if err := validateLoopback(config.Addr); err != nil {
		return nil, err
	}
	if config.DataDir == "" {
		config.DataDir = DefaultConfig().DataDir
	}
	if err := os.MkdirAll(config.DataDir, 0o700); err != nil {
		return nil, err
	}
	release, err := acquireProfile(config.DataDir)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", config.Addr)
	if err != nil {
		release()
		return nil, fmt.Errorf("listen on %s: %w", config.Addr, err)
	}
	config.Addr = listener.Addr().String()
	token, err := EngineToken(config.DataDir)
	if err != nil {
		release()
		listener.Close()
		return nil, err
	}
	restoreDirectoryAccess(config.DataDir)
	store, err := NewStore(config.DataDir)
	if err != nil {
		release()
		listener.Close()
		return nil, err
	}
	themeLibrary, err := NewThemeLibrary(config.DataDir)
	if err != nil {
		store.Close()
		release()
		listener.Close()
		return nil, err
	}
	artwork, err := newArtworkStore(config.DataDir)
	if err != nil {
		store.Close()
		release()
		listener.Close()
		return nil, err
	}
	d := &Daemon{
		config: config, store: store, themeLibrary: themeLibrary, artwork: artwork, releaseProfile: release, authToken: token, listener: listener,
		projectReads: make(chan struct{}, 4),
		deletions:    newDeletionFence(),
	}
	d.sessions = NewSessionManager(store, config.DataDir, d.deletions)
	d.terminals = NewTerminalManager(store, config.DataDir, d.deletions)
	d.server = &http.Server{Addr: config.Addr, Handler: d.routes(), ReadHeaderTimeout: 5 * time.Second}
	return d, nil
}

func (d *Daemon) Run(ctx context.Context) error {
	defer d.releaseProfile()
	listener := d.listener
	d.server.BaseContext = func(net.Listener) context.Context { return ctx }

	errCh := make(chan error, 1)
	go func() { errCh <- d.server.Serve(listener) }()
	go d.sessions.DrainAllQueues()
	go d.sessions.recoverPendingTitles()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = d.server.Shutdown(shutdownCtx)
		d.terminals.Shutdown(shutdownCtx)
		d.sessions.Shutdown(shutdownCtx)
		_ = d.store.Close()
		return nil
	case err := <-errCh:
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		d.terminals.Shutdown(shutdownCtx)
		d.sessions.Shutdown(shutdownCtx)
		_ = d.store.Close()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (d *Daemon) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pid": os.Getpid(), "version": "0.4.0-go", "engine_protocol": EngineProtocol, "profile": ProfileID(d.config.DataDir)})
	})
	mux.HandleFunc("GET /api/meta", d.handleMeta)
	mux.HandleFunc("GET /api/title-settings", d.handleTitleSettings)
	mux.HandleFunc("PATCH /api/title-settings", d.handleTitleSettings)
	mux.HandleFunc("GET /api/state", d.handleSnapshot)
	mux.HandleFunc("GET /api/diagnostics", d.handleDiagnostics)
	mux.HandleFunc("GET /api/events", d.handleEvents)
	mux.HandleFunc("GET /api/themes", d.handleThemeLibrary)
	mux.HandleFunc("GET /api/new-thread-artwork", d.handleNewThreadArtwork)
	mux.HandleFunc("POST /api/new-thread-artwork", d.handleUploadNewThreadArtwork)
	mux.HandleFunc("PATCH /api/new-thread-artwork/effect", d.handleArtworkEffect)
	mux.HandleFunc("DELETE /api/new-thread-artwork", d.handleRemoveNewThreadArtwork)
	mux.HandleFunc("GET /api/new-thread-artwork/media", d.handleNewThreadArtworkMedia)
	mux.HandleFunc("POST /api/themes/link", d.handleLinkThemeSource)
	mux.HandleFunc("POST /api/themes/{id}/reload", d.handleReloadThemeSource)
	mux.HandleFunc("POST /api/themes/{id}/unlink", d.handleUnlinkThemeSource)
	mux.HandleFunc("POST /api/themes/{id}/duplicate", d.handleDuplicateThemeSource)
	mux.HandleFunc("DELETE /api/themes/{id}", d.handleRemoveThemeSource)
	mux.HandleFunc("POST /api/attachments", d.handleUploadAttachment)
	mux.HandleFunc("GET /api/attachments/{id}/media", d.handleAttachmentMedia)
	mux.HandleFunc("GET /api/sessions", d.handleListSessions)
	mux.HandleFunc("POST /api/sessions", d.handleCreateSession)
	mux.HandleFunc("GET /api/projects", d.handleProjects)
	mux.HandleFunc("GET /api/projects/directories", d.handleProjectDirectories)
	mux.HandleFunc("POST /api/projects", d.handleRegisterProject)
	mux.HandleFunc("POST /api/projects/rename", d.handleRenameProject)
	mux.HandleFunc("POST /api/projects/remove", d.handleRemoveProject)
	mux.HandleFunc("POST /api/projects/scan", d.handleScanProjects)
	mux.HandleFunc("GET /api/sessions/{id}", d.handleGetSession)
	mux.HandleFunc("POST /api/sessions/{id}/fork", d.handleForkSession)
	mux.HandleFunc("PATCH /api/sessions/{id}", d.handleSessionDetails)
	mux.HandleFunc("PATCH /api/sessions/{id}/archive", d.handleSessionArchive)
	mux.HandleFunc("DELETE /api/sessions/{id}", d.handleDeleteSession)
	mux.HandleFunc("GET /api/sessions/{id}/provider-state", d.handleProviderState)
	mux.HandleFunc("POST /api/sessions/{id}/provider-requests/{requestID}", d.handleProviderReply)
	mux.HandleFunc("GET /api/sessions/{id}/stream", d.handleStream)
	mux.HandleFunc("POST /api/sessions/{id}/input", d.handleInput)
	mux.HandleFunc("POST /api/sessions/{id}/messages", d.handleMessage)
	mux.HandleFunc("POST /api/sessions/{id}/surface", d.handleSessionSurface)
	mux.HandleFunc("GET /api/sessions/{id}/message-queue", d.handleListMessageQueue)
	mux.HandleFunc("POST /api/sessions/{id}/message-queue", d.handleEnqueueMessage)
	mux.HandleFunc("PUT /api/sessions/{id}/message-queue/{messageID}", d.handleEditQueuedMessage)
	mux.HandleFunc("DELETE /api/sessions/{id}/message-queue/{messageID}", d.handleDeleteQueuedMessage)
	mux.HandleFunc("POST /api/sessions/{id}/message-queue/{messageID}/steer", d.handleSteerQueuedMessage)
	mux.HandleFunc("POST /api/sessions/{id}/resume-tui", d.handleResumeTUI)
	mux.HandleFunc("GET /api/sessions/{id}/commands", d.handleSessionCommands)
	mux.HandleFunc("POST /api/sessions/{id}/resize", d.handleResize)
	mux.HandleFunc("POST /api/sessions/{id}/stop", d.handleStop)
	mux.HandleFunc("POST /api/providers/{provider}/sign-in", d.handleProviderSetup)
	mux.HandleFunc("POST /api/projects/access", d.handleDirectoryAccess)
	mux.HandleFunc("GET /api/projects/access", d.handleDirectoryAccessStatus)
	mux.HandleFunc("GET /api/projects/branches", d.handleBranches)
	mux.HandleFunc("GET /api/sessions/{id}/preview-servers", d.handlePreviewServers)
	mux.HandleFunc("POST /api/sessions/{id}/stage", d.handleStage)
	mux.HandleFunc("GET /api/sessions/{id}/diff", d.handleDiff)
	mux.HandleFunc("GET /api/sessions/{id}/files", d.handleFiles)
	mux.HandleFunc("GET /api/sessions/{id}/file-media", d.handleFileMedia)
	mux.HandleFunc("GET /api/sessions/{id}/file", d.handleFile)
	mux.HandleFunc("PUT /api/sessions/{id}/file", d.handleFile)
	mux.HandleFunc("GET /api/sessions/{id}/history", d.handleHistory)
	mux.HandleFunc("GET /api/sessions/{id}/turns", d.handleTurns)
	mux.HandleFunc("POST /api/sessions/{id}/commit", d.handleCommit)
	mux.HandleFunc("POST /api/sessions/{id}/model", d.handleModel)
	mux.HandleFunc("GET /api/sessions/{id}/terminals", d.handleListTerminals)
	mux.HandleFunc("POST /api/sessions/{id}/terminals", d.handleCreateTerminal)
	mux.HandleFunc("GET /api/terminals/{id}/stream", d.handleTerminalStream)
	mux.HandleFunc("POST /api/terminals/{id}/input", d.handleTerminalInput)
	mux.HandleFunc("POST /api/terminals/{id}/resize", d.handleTerminalResize)
	mux.HandleFunc("POST /api/terminals/{id}/stop", d.handleTerminalStop)
	mux.HandleFunc("GET /api/github/pull-requests", d.handlePullRequests)
	mux.HandleFunc("POST /api/github/pull-requests", d.handleCreatePullRequest)
	mux.HandleFunc("GET /api/jira/tickets/{key}", d.handleJiraTicket)
	return cors(d.authorize(mux))
}

func (d *Daemon) handleProjects(w http.ResponseWriter, _ *http.Request) {
	metadata, err := d.store.ListProjectMetadata()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	projects := make([]string, 0, len(metadata))
	names := map[string]string{}
	for _, project := range metadata {
		projects = append(projects, project.Path)
		if project.DisplayName != "" {
			names[project.Path] = project.DisplayName
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects, "project_names": names})
}

func (d *Daemon) handleScanProjects(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Root string `json:"root"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	projects, err := scanProjectRoot(body.Root)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	for i, path := range projects {
		if canonical, resolveErr := filepath.EvalSymlinks(path); resolveErr == nil {
			projects[i] = canonical
		}
	}
	projects, err = d.store.FilterRemovedProjects(projects)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	if err = d.store.RecordProjectCatalog(projects); err != nil {
		writeError(w, 500, err)
		return
	}
	conversations := discoverExternalConversations(body.Root, projects)
	writeJSON(w, http.StatusOK, map[string]any{"root": body.Root, "projects": projects, "conversations": conversations})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && !strings.HasPrefix(origin, "http://localhost:") && !strings.HasPrefix(origin, "http://127.0.0.1:") && !strings.HasPrefix(origin, "wails://") && origin != "wails://wails" {
			writeError(w, 403, fmt.Errorf("origin is not allowed"))
			return
		}
		if origin == "" || strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:") || strings.HasPrefix(origin, "wails://") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		bodyLimit := int64(3 * 1024 * 1024)
		if r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/file") {
			bodyLimit = 8*1024*1024 + 1024
		}
		r.Body = http.MaxBytesReader(w, r.Body, bodyLimit)
		next.ServeHTTP(w, r)
	})
}

func (d *Daemon) handleMeta(w http.ResponseWriter, r *http.Request) {
	agents := []map[string]any{}
	for _, name := range []string{"claude", "codex", "grok", "devin", "hermes", "pi", "antigravity", "copilot", "opencode", "shell"} {
		path, err := resolveProgram(name)
		if isACPAgent(name) {
			path, _, err = resolveACPProgram(name)
		}
		capabilities := providerCapabilities(name)
		if name == "codex" && err == nil && supportsCodexServer(path) {
			capabilities.PersistentTurns = true
			capabilities.MidTurnSteering = true
			capabilities.Usage = true
			capabilities.Transport = "app-server-stdio"
		}
		agents = append(agents, map[string]any{"id": name, "available": err == nil, "path": path, "capabilities": capabilities, "models": providerModels(name)})
	}
	_, ghErr := resolveProgram("gh")
	writeJSON(w, http.StatusOK, map[string]any{"agents": agents, "github_available": ghErr == nil, "data_dir": d.config.DataDir})
}

func (d *Daemon) handleListSessions(w http.ResponseWriter, _ *http.Request) {
	sessions, err := d.store.ListSessions()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

func (d *Daemon) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	var request CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	d.projectMu.Lock()
	session, err := d.sessions.Create(r.Context(), request)
	d.projectMu.Unlock()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (d *Daemon) handleForkSession(w http.ResponseWriter, r *http.Request) {
	var request struct {
		ParentSessionID string `json:"parent_session_id"`
		Mode            string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if request.Mode != "" && request.Mode != "fork" && request.Mode != "fresh" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("side chat mode must be fork or fresh"))
		return
	}
	sourceID := r.PathValue("id")
	release, err := d.deletions.admit(sourceID)
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	defer release()
	if request.ParentSessionID != "" && request.ParentSessionID != sourceID {
		releaseParent, admitErr := d.deletions.admit(request.ParentSessionID)
		if admitErr != nil {
			writeError(w, http.StatusConflict, admitErr)
			return
		}
		defer releaseParent()
	}
	d.projectMu.Lock()
	session, err := d.sessions.Fork(r.Context(), sourceID, request.ParentSessionID, request.Mode != "fresh")
	d.projectMu.Unlock()
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (d *Daemon) handleGetSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	release, err := d.deletions.admit(id)
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	defer release()
	session, err := d.store.GetSession(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

var upgrader = websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: func(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:") || strings.HasPrefix(origin, "wails://")
}}

func (d *Daemon) handleStream(w http.ResponseWriter, r *http.Request) {
	after, err := streamCursor(r)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	initial, output, cancel, err := d.sessions.Subscribe(r.PathValue("id"), after)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		cancel()
		return
	}
	defer conn.Close()
	defer cancel()
	go func() {
		defer cancel()
		for {
			if _, _, err := conn.NextReader(); err != nil {
				return
			}
		}
	}()
	cursor := initial.Cursor
	_ = conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	_ = conn.WriteJSON(map[string]any{"type": "output", "data": string(initial.Data), "replay": true, "reset": initial.Reset || after == 0, "offset": initial.Offset, "cursor": cursor})
	for chunk := range output {
		cursor += int64(len(chunk))
		_ = conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
		if err := conn.WriteJSON(map[string]any{"type": "output", "data": string(chunk), "cursor": cursor}); err != nil {
			return
		}
	}
	session, _ := d.store.GetSession(r.PathValue("id"))
	_ = conn.WriteJSON(map[string]any{"type": "status", "status": session.Status, "exit_code": session.ExitCode})
}

func (d *Daemon) handleInput(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Data string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	if err := d.sessions.Write(r.PathValue("id"), body.Data); err != nil {
		writeError(w, 409, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d *Daemon) handleMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := d.sessions.Resume(session, body.Text); err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	session, _ = d.store.GetSession(session.ID)
	writeJSON(w, http.StatusAccepted, session)
}

func (d *Daemon) handleSessionSurface(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := d.sessions.SwitchSurface(session, body.Mode); err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	session, err = d.store.GetSession(session.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, session)
}

func (d *Daemon) handleListMessageQueue(w http.ResponseWriter, r *http.Request) {
	messages, err := d.store.ListQueuedMessages(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

func (d *Daemon) handleEnqueueMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	body.Text = strings.TrimSpace(body.Text)
	if body.Text == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("message is required"))
		return
	}
	id := r.PathValue("id")
	release, err := d.deletions.admit(id)
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	defer release()
	session, err := d.store.GetSession(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if session.Mode != "chat" || session.Agent == "shell" {
		writeError(w, http.StatusConflict, fmt.Errorf("message queue is only available for chat sessions"))
		return
	}
	now := time.Now().UTC()
	message := QueuedMessage{ID: uuid.NewString(), SessionID: session.ID, Text: body.Text, Status: "queued", CreatedAt: now, UpdatedAt: now}
	if err := d.store.EnqueueMessage(message); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	go func() { _ = d.sessions.DrainQueue(session.ID) }()
	writeJSON(w, http.StatusAccepted, message)
}

func (d *Daemon) handleEditQueuedMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Text) == "" {
		writeError(w, 400, fmt.Errorf("message is required"))
		return
	}
	if err := d.store.EditQueuedMessage(r.PathValue("id"), r.PathValue("messageID"), strings.TrimSpace(body.Text)); err != nil {
		writeError(w, 409, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (d *Daemon) handleDeleteQueuedMessage(w http.ResponseWriter, r *http.Request) {
	if err := d.store.DeleteQueuedMessage(r.PathValue("id"), r.PathValue("messageID")); err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d *Daemon) handleSteerQueuedMessage(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	if handled, err := d.sessions.steerCodex(sessionID, r.PathValue("messageID")); handled {
		if err != nil {
			writeError(w, 409, err)
		} else {
			w.WriteHeader(204)
		}
		return
	}
	if err := d.store.PromoteQueuedMessage(sessionID, r.PathValue("messageID")); err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	go func() { _ = d.sessions.DrainQueue(sessionID) }()
	w.WriteHeader(http.StatusNoContent)
}

func (d *Daemon) handleResumeTUI(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := d.sessions.ResumeTUI(session); err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	session, _ = d.store.GetSession(session.ID)
	writeJSON(w, http.StatusAccepted, session)
}

func (d *Daemon) handleSessionCommands(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"commands": discoverAgentCommands(session)})
}

func (d *Daemon) handleResize(w http.ResponseWriter, r *http.Request) {
	var body struct{ Rows, Cols uint16 }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	if err := d.sessions.Resize(r.PathValue("id"), body.Rows, body.Cols); err != nil {
		writeError(w, 409, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d *Daemon) handleStop(w http.ResponseWriter, r *http.Request) {
	if err := d.sessions.Stop(r.PathValue("id")); err != nil {
		writeError(w, 409, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d *Daemon) handleDiff(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}

	var diff string
	switch r.URL.Query().Get("scope") {
	case "staged":
		diff, err = gitOutput(r.Context(), session.WorktreePath, "diff", "--no-ext-diff", "--cached", "--patch", "--")
	case "turn":
		var base string
		err = d.store.db.QueryRow(`SELECT start_tree FROM turns WHERE session_id=? ORDER BY generation DESC LIMIT 1`, session.ID).Scan(&base)
		if err == nil && base == "" {
			err = fmt.Errorf("No snapshot is available for this turn. Send another message to begin a new turn.")
		}
		if err == nil {
			var current string
			current, err = snapshotWorkingTree(r.Context(), session.WorktreePath)
			if err == nil {
				diff, err = gitOutput(r.Context(), session.WorktreePath, "diff", "--no-ext-diff", "--patch", base, current, "--")
			}
		}
	case "working":
		diff, err = worktreeDiff(r.Context(), session.WorktreePath, "HEAD")
	case "branch", "":
		diff, err = worktreeDiff(r.Context(), session.WorktreePath, session.BaseBranch)
	default:
		err = fmt.Errorf("unknown diff scope")
	}

	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"diff": diff})
}

func (d *Daemon) handleFiles(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	files, err := worktreeFiles(r.Context(), session.WorktreePath)
	if err == nil && r.URL.Query().Get("ignored") == "1" && session.Branch != "" {
		var ignored string
		ignored, err = gitOutput(r.Context(), session.WorktreePath, "ls-files", "--others", "--ignored", "--exclude-standard", "-z")
		if err == nil {
			for _, path := range strings.Split(ignored, "\x00") {
				if path != "" {
					files = append(files, path)
				}
			}
		}
	}
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"files": files})
}

func (d *Daemon) handlePullRequests(w http.ResponseWriter, r *http.Request) {
	repo := r.URL.Query().Get("repo")
	if repo == "" {
		writeError(w, 400, fmt.Errorf("repo is required"))
		return
	}
	prs, err := listPullRequests(r.Context(), repo)
	if err != nil {
		writeError(w, 502, err)
		return
	}
	writeJSON(w, 200, map[string]any{"pull_requests": prs})
}

func (d *Daemon) handleCreatePullRequest(w http.ResponseWriter, r *http.Request) {
	var body struct{ SessionID, Title, Body, Base string }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	session, err := d.store.GetSession(body.SessionID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	operationID, err := d.store.BeginOperation(session.ID, "push-pr")
	if err != nil {
		writeError(w, 500, err)
		return
	}
	url, err := createPullRequest(r.Context(), session, body.Title, body.Body, body.Base)
	if err != nil {
		_ = d.store.FinishOperation(operationID, "failed", "")
		writeError(w, 502, err)
		return
	}
	if err := d.store.CompletePR(operationID, session.ID, url); err != nil {
		writeError(w, 500, fmt.Errorf("draft created at %s but local state could not be saved: %w", url, err))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"url": url})
}

func (d *Daemon) handleJiraTicket(w http.ResponseWriter, r *http.Request) {
	key := strings.ToUpper(strings.TrimSpace(r.PathValue("key")))
	if key == "" {
		writeError(w, 400, fmt.Errorf("ticket key is required"))
		return
	}
	ticket, err := fetchJiraTicket(r.Context(), key)
	if err != nil {
		writeError(w, 502, err)
		return
	}
	writeJSON(w, 200, ticket)
}

func writeStoreError(w http.ResponseWriter, err error) {
	if IsNotFound(err) {
		writeError(w, 404, fmt.Errorf("session not found"))
		return
	}
	writeError(w, 500, err)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (d *Daemon) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		supplied := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if supplied == "" && (r.URL.Path == "/api/events" || strings.HasSuffix(r.URL.Path, "/stream") || (strings.HasPrefix(r.URL.Path, "/api/attachments/") && strings.HasSuffix(r.URL.Path, "/media")) || r.URL.Path == "/api/new-thread-artwork/media" || (strings.HasPrefix(r.URL.Path, "/api/sessions/") && strings.HasSuffix(r.URL.Path, "/file-media"))) {
			supplied = r.URL.Query().Get("token")
		}
		if subtle.ConstantTimeCompare([]byte(supplied), []byte(d.authToken)) != 1 {
			writeError(w, 401, fmt.Errorf("engine authentication required"))
			return
		}
		next.ServeHTTP(w, r)
	})
}
