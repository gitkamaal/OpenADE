package daemon

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
)

const cursorSDKVersion = "1.0.32"

// The MIT-licensed Zeron shim is adapted for OpenADE and installed beside an
// integrity-locked Cursor SDK. The SDK itself is downloaded from npm on first
// use; it is not copied into this repository or the application bundle.
//
//go:embed cursor_adapter/shim.mjs cursor_adapter/package.json cursor_adapter/package-lock.json cursor_adapter/LICENSE.zeron
var cursorAdapterFiles embed.FS

var cursorInstallLock sync.Mutex
var cursorNodeVersions sync.Map
var cursorNodeVersionPattern = regexp.MustCompile(`^v(\d+)\.(\d+)\.`)

func checkCursorNode(node string) error {
	info, err := os.Stat(node)
	if err != nil {
		return err
	}
	identity := fmt.Sprintf("%s:%d:%d", node, info.Size(), info.ModTime().UnixNano())
	if cached, ok := cursorNodeVersions.Load(identity); ok {
		if cached.(bool) {
			return nil
		}
		return fmt.Errorf("Cursor SDK requires Node.js 22.13 or newer")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, node, "--version")
	cmd.Env = processEnvironment()
	cmd.WaitDelay = 100 * time.Millisecond
	var output limitedOutput
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Cursor SDK could not check Node.js: %w", err)
	}
	match := cursorNodeVersionPattern.FindStringSubmatch(strings.TrimSpace(string(output.data)))
	if len(match) != 3 {
		return fmt.Errorf("Cursor SDK could not identify the Node.js version")
	}
	major, _ := strconv.Atoi(match[1])
	minor, _ := strconv.Atoi(match[2])
	supported := major > 22 || major == 22 && minor >= 13
	cursorNodeVersions.Store(identity, supported)
	if !supported {
		return fmt.Errorf("Cursor SDK requires Node.js 22.13 or newer")
	}
	return nil
}

type limitedOutput struct {
	data  []byte
	limit int
}

func (w *limitedOutput) Write(p []byte) (int, error) {
	limit := w.limit
	if limit == 0 {
		limit = 16 * 1024
	}
	if remaining := limit - len(w.data); remaining > 0 {
		w.data = append(w.data, p[:min(len(p), remaining)]...)
	}
	return len(p), nil
}

func cursorOverride() (string, bool, error) {
	configured := strings.TrimSpace(os.Getenv("OPENADE_CURSOR_SHIM_EXECUTABLE"))
	if configured == "" {
		return "", false, nil
	}
	path, err := filepath.Abs(configured)
	if err != nil {
		return "", true, err
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return "", true, err
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&0o111 == 0 {
		return "", true, fmt.Errorf("the configured Cursor shim is not an executable file")
	}
	return path, true, nil
}

func cursorInstallIdentity() (string, error) {
	shim, err := cursorAdapterFiles.ReadFile("cursor_adapter/shim.mjs")
	if err != nil {
		return "", err
	}
	lock, err := cursorAdapterFiles.ReadFile("cursor_adapter/package-lock.json")
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	_, _ = hash.Write(shim)
	_, _ = hash.Write(lock)
	return hex.EncodeToString(hash.Sum(nil))[:16], nil
}

func cursorInstallDir(dataDir string) (string, error) {
	identity, err := cursorInstallIdentity()
	if err != nil {
		return "", err
	}
	return filepath.Join(dataDir, "adapters", "cursor-sdk", cursorSDKVersion+"-"+identity), nil
}

func cursorShimAt(dir string) (string, bool) {
	marker, err := os.ReadFile(filepath.Join(dir, ".openade-install-ok"))
	if err != nil || strings.TrimSpace(string(marker)) != cursorSDKVersion {
		return "", false
	}
	packageData, err := os.ReadFile(filepath.Join(dir, "node_modules", "@cursor", "sdk", "package.json"))
	if err != nil {
		return "", false
	}
	var pkg struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(packageData, &pkg) != nil || pkg.Version != cursorSDKVersion {
		return "", false
	}
	shim := filepath.Join(dir, "shim.mjs")
	if info, err := os.Stat(shim); err != nil || !info.Mode().IsRegular() {
		return "", false
	}
	return shim, true
}

func cursorRuntimeAvailable(dataDir string) (string, error) {
	if override, configured, err := cursorOverride(); configured {
		return override, err
	}
	node, err := resolveProgram("node")
	if err != nil {
		return "", fmt.Errorf("Cursor SDK needs Node.js 22.13 or newer: %w", err)
	}
	if err := checkCursorNode(node); err != nil {
		return "", err
	}
	dir, err := cursorInstallDir(dataDir)
	if err == nil {
		if _, installed := cursorShimAt(dir); installed {
			return node, nil
		}
	}
	if _, err := resolveProgram("npm"); err != nil {
		return "", fmt.Errorf("Cursor SDK needs npm for its first local install: %w", err)
	}
	return node, nil
}

func (m *SessionManager) resolveCursorRuntime(ctx context.Context) (string, []string, error) {
	if override, configured, err := cursorOverride(); configured {
		return override, nil, err
	}
	node, err := resolveProgram("node")
	if err != nil {
		return "", nil, fmt.Errorf("Cursor SDK needs Node.js 22.13 or newer: %w", err)
	}
	if err := checkCursorNode(node); err != nil {
		return "", nil, err
	}
	dir, err := cursorInstallDir(m.dataDir)
	if err != nil {
		return "", nil, err
	}
	if shim, ok := cursorShimAt(dir); ok {
		return node, []string{shim}, nil
	}
	cursorInstallLock.Lock()
	defer cursorInstallLock.Unlock()
	if shim, ok := cursorShimAt(dir); ok {
		return node, []string{shim}, nil
	}
	npm, err := resolveProgram("npm")
	if err != nil {
		return "", nil, fmt.Errorf("Cursor SDK needs npm for its first local install: %w", err)
	}
	root := filepath.Dir(dir)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", nil, err
	}
	stage, err := os.MkdirTemp(root, ".install-")
	if err != nil {
		return "", nil, err
	}
	defer os.RemoveAll(stage)
	for _, name := range []string{"shim.mjs", "package.json", "package-lock.json", "LICENSE.zeron"} {
		data, readErr := cursorAdapterFiles.ReadFile("cursor_adapter/" + name)
		if readErr != nil {
			return "", nil, readErr
		}
		if writeErr := os.WriteFile(filepath.Join(stage, name), data, 0o600); writeErr != nil {
			return "", nil, writeErr
		}
	}
	installCtx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(installCtx, npm, "ci", "--no-audit", "--no-fund", "--no-progress", "--loglevel=error", "--include=optional", "--cache", filepath.Join(root, ".npm-cache"))
	cmd.Dir = stage
	cmd.Env = processEnvironment()
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = 3 * time.Second
	var output limitedOutput
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := cmd.Run(); err != nil {
		if cmd.Process != nil {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		if installCtx.Err() != nil {
			return "", nil, fmt.Errorf("Cursor SDK install timed out or was cancelled; check the network and retry")
		}
		// npm output can include registry credentials or private URLs. Keep it
		// out of HTTP errors and transcripts.
		return "", nil, fmt.Errorf("Cursor SDK install failed: %w; check npm registry access and local permissions", err)
	}
	if err := os.WriteFile(filepath.Join(stage, ".openade-install-ok"), []byte(cursorSDKVersion+"\n"), 0o600); err != nil {
		return "", nil, err
	}
	if _, ok := cursorShimAt(stage); !ok {
		return "", nil, fmt.Errorf("Cursor SDK install did not contain the pinned package")
	}
	if info, statErr := os.Stat(dir); statErr == nil && info.IsDir() {
		stale := dir + ".stale-" + uuid.NewString()
		if err := os.Rename(dir, stale); err != nil {
			return "", nil, fmt.Errorf("could not replace an incomplete Cursor SDK install: %w", err)
		}
		defer os.RemoveAll(stale)
	}
	if err := os.Rename(stage, dir); err != nil {
		if shim, ok := cursorShimAt(dir); ok {
			return node, []string{shim}, nil
		}
		return "", nil, fmt.Errorf("could not activate the Cursor SDK install: %w", err)
	}
	shim, ok := cursorShimAt(dir)
	if !ok {
		return "", nil, fmt.Errorf("Cursor SDK install was not readable after activation")
	}
	return node, []string{shim}, nil
}
