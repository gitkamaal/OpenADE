package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/hkd987/OpenADE/apps/desktop/internal/daemon"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func daemonURL() string { return daemon.EngineURL(daemon.DefaultConfig()) }

type App struct {
	ctx             context.Context
	mu              sync.RWMutex
	daemonErr       string
	daemonReady     chan struct{}
	connectionOnce  sync.Once
	connectionReady chan struct{}
	connection      map[string]string
	connectionErr   error
}

func NewApp() *App { return &App{daemonReady: make(chan struct{})} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go func() {
		err := ensureDaemon()
		a.mu.Lock()
		if err != nil {
			a.daemonErr = err.Error()
		} else {
			a.daemonErr = ""
		}
		a.mu.Unlock()
		close(a.daemonReady)
		runtime.EventsEmit(ctx, "daemon:ready", err == nil)
	}()
}

// shutdown intentionally leaves the daemon alive so PTYs continue running.
func (a *App) shutdown(context.Context) {}

func (a *App) DaemonURL() string { return daemonURL() }

func (a *App) DaemonStatus() map[string]any {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return map[string]any{"url": daemonURL(), "ready": a.daemonErr == "", "error": a.daemonErr}
}

func (a *App) OpenExternal(url string) {
	if a.ctx != nil {
		runtime.BrowserOpenURL(a.ctx, url)
	}
}

func (a *App) SelectRepository() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("desktop window is not ready")
	}
	root, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Choose a Git repository",
		CanCreateDirectories: true,
	})
	if err != nil || root == "" {
		return root, err
	}
	if err = a.registerRepositoryAccess(root); err != nil {
		return "", err
	}
	// A linked worktree's .git file points outside the selected directory.
	// Ask through the native picker for that original repository as well.
	if data, readErr := os.ReadFile(filepath.Join(root, ".git")); readErr == nil && len(data) < 8192 && strings.HasPrefix(string(data), "gitdir:") {
		gitDir := strings.TrimSpace(strings.TrimPrefix(string(data), "gitdir:"))
		if !filepath.IsAbs(gitDir) {
			gitDir = filepath.Join(root, gitDir)
		}
		if index := strings.Index(filepath.Clean(gitDir), string(filepath.Separator)+".git"+string(filepath.Separator)); index > 0 {
			original := filepath.Clean(gitDir)[:index]
			connection, connectionErr := a.EngineConnection()
			if connectionErr != nil {
				return "", connectionErr
			}
			req, _ := http.NewRequest(http.MethodGet, connection["url"]+"/api/projects/access?root="+url.QueryEscape(original), nil)
			req.Header.Set("Authorization", "Bearer "+connection["token"])
			response, requestErr := (&http.Client{Timeout: 3 * time.Second}).Do(req)
			allowed := false
			if requestErr == nil {
				var result struct {
					Allowed bool `json:"allowed"`
				}
				_ = json.NewDecoder(response.Body).Decode(&result)
				response.Body.Close()
				allowed = result.Allowed
			}
			if !allowed {
				selected, dialogErr := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose the original repository for this worktree", DefaultDirectory: original})
				if dialogErr != nil {
					return "", dialogErr
				}
				if filepath.Clean(selected) != original {
					return "", fmt.Errorf("select the original repository %s to use this linked worktree", original)
				}
				if err = a.registerRepositoryAccess(selected); err != nil {
					return "", err
				}
			}
		}
	}

	return root, nil
}

func ensureDaemon() error {
	client := &http.Client{Timeout: 350 * time.Millisecond}
	if healthy(client) {
		return nil
	}
	if response, err := client.Get(daemonURL() + "/api/health"); err == nil {
		response.Body.Close()
		if response.StatusCode == http.StatusOK {
			return fmt.Errorf("an older or different engine owns %s; close its sessions before upgrading", daemonURL())
		}
	}
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate OpenADE executable: %w", err)
	}
	config := daemon.DefaultConfig()
	if err := os.MkdirAll(config.DataDir, 0o700); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}
	logFile, err := os.OpenFile(filepath.Join(config.DataDir, "daemon.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open daemon log: %w", err)
	}
	command := exec.Command(executable, "--daemon", "--data-dir", config.DataDir, "--addr", config.Addr)
	command.Stdout = logFile
	command.Stderr = logFile
	command.Stdin = nil
	command.Env = append(os.Environ(), "OPENADE_DATA_DIR="+config.DataDir)
	if err := command.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf("start daemon: %w", err)
	}
	_ = command.Process.Release()
	_ = logFile.Close()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if healthy(client) {
			return nil
		}
		time.Sleep(120 * time.Millisecond)
	}
	return fmt.Errorf("daemon did not become ready; see %s", filepath.Join(config.DataDir, "daemon.log"))
}

func healthy(client *http.Client) bool {
	response, err := client.Get(daemonURL() + "/api/health")
	if err != nil {
		return false
	}
	defer response.Body.Close()
	var health struct {
		Profile  string `json:"profile"`
		Protocol int    `json:"engine_protocol"`
	}
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		return false
	}
	return response.StatusCode == http.StatusOK && health.Protocol == daemon.EngineProtocol && health.Profile == daemon.ProfileID(daemon.DefaultConfig().DataDir)
}

func (a *App) EngineConnection() (map[string]string, error) {
	select {
	case <-a.daemonReady:
	case <-time.After(9 * time.Second):
		return nil, fmt.Errorf("the local engine did not start; check access to its data folder")
	}
	a.mu.RLock()
	bootError := a.daemonErr
	a.mu.RUnlock()
	if bootError != "" {
		return nil, fmt.Errorf("%s", bootError)
	}
	a.connectionOnce.Do(func() {
		a.connectionReady = make(chan struct{})
		go func() {
			defer close(a.connectionReady)
			config := daemon.DefaultConfig()
			token, err := daemon.EngineToken(config.DataDir)
			a.connectionErr = err
			if err == nil {
				a.connection = map[string]string{"url": daemon.EngineURL(config), "token": token}
			}
		}()
	})
	select {
	case <-a.connectionReady:
		return a.connection, a.connectionErr
	case <-time.After(3 * time.Second):
		return nil, fmt.Errorf("OpenADE cannot read its data folder. Allow access to that folder, or use the default Application Support location")
	}
}

func (a *App) CopyText(text string) error {
	if a.ctx == nil {
		return fmt.Errorf("desktop window is not ready")
	}
	return runtime.ClipboardSetText(a.ctx, text)
}

func (a *App) Reconnect() error {
	err := ensureDaemon()
	a.mu.Lock()
	if err != nil {
		a.daemonErr = err.Error()
	} else {
		a.daemonErr = ""
	}
	a.mu.Unlock()
	return err
}

func (a *App) registerRepositoryAccess(root string) error {
	bookmark, err := daemon.DirectoryBookmark(root)
	if err != nil {
		return err
	}
	if bookmark != "" {
		connection, err := a.EngineConnection()
		if err != nil {
			return err
		}
		body, _ := json.Marshal(map[string]string{"root": root, "bookmark": bookmark})
		req, _ := http.NewRequest(http.MethodPost, connection["url"]+"/api/projects/access", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+connection["token"])
		req.Header.Set("Content-Type", "application/json")
		response, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		if response.StatusCode != 204 {
			var result struct {
				Error string `json:"error"`
			}
			_ = json.NewDecoder(response.Body).Decode(&result)
			return fmt.Errorf("%s", result.Error)
		}
	}
	return nil
}
