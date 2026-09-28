package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// Cursor's pinned SDK is driven through a distinct JSONL shim. These are its
// public, normalized frames; it is intentionally not passed through ACP.
type cursorFrame struct {
	Event   string          `json:"ev"`
	AgentID string          `json:"agentId"`
	Model   string          `json:"model"`
	Text    string          `json:"text"`
	Status  string          `json:"status"`
	Error   json.RawMessage `json:"error"`
	Message string          `json:"message"`
	Phase   string          `json:"phase"`
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Parent  string          `json:"parent"`
	Args    json.RawMessage `json:"args"`
	Input   uint64          `json:"input"`
	Output  uint64          `json:"output"`
}

type cursorWire struct {
	cmd         *exec.Cmd
	stdin       io.WriteCloser
	writeMu     sync.Mutex
	stopOnce    sync.Once
	events      chan cursorFrame
	readDone    chan struct{}
	processDone chan struct{}
	mu          sync.Mutex
	err         error
}

func startCursorWire(program string, args []string, session Session, stateDir string) (*cursorWire, error) {
	cmd := exec.Command(program, args...)
	cmd.Dir = session.WorktreePath
	cmd.Env = processEnvironment("OPENADE_SESSION_ID="+session.ID, "OPENADE_CURSOR_STATE_DIR="+stateDir)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, stdoutWriter, err := os.Pipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	cmd.Stdout = stdoutWriter
	// The SDK may include account or request details in stderr. Never append
	// it to the transcript or expose it in an HTTP response.
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stdoutWriter.Close()
		return nil, err
	}
	_ = stdoutWriter.Close()
	wire := &cursorWire{cmd: cmd, stdin: stdin, events: make(chan cursorFrame, 256), readDone: make(chan struct{}), processDone: make(chan struct{})}
	go wire.read(stdout)
	go func() {
		_ = cmd.Wait()
		// The SDK can spawn local tool children. Reap the whole group if its
		// leader exits while descendants still own the stdout pipe.
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		select {
		case <-wire.readDone:
		case <-time.After(time.Second):
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			_ = stdout.Close()
			<-wire.readDone
		}
		close(wire.processDone)
	}()
	return wire, nil
}

func (w *cursorWire) read(stdout io.ReadCloser) {
	defer close(w.readDone)
	defer close(w.events)
	defer stdout.Close()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 32*1024), maxProviderFrameBytes)
	for scanner.Scan() {
		var frame cursorFrame
		if err := json.Unmarshal(scanner.Bytes(), &frame); err != nil || frame.Event == "" {
			w.setError(fmt.Errorf("Cursor shim emitted an invalid protocol frame"))
			w.stop()
			return
		}
		select {
		case w.events <- frame:
		default:
			w.setError(fmt.Errorf("Cursor event buffer exceeded its limit"))
			w.stop()
			return
		}
	}
	if err := scanner.Err(); err != nil {
		w.setError(fmt.Errorf("Cursor shim output could not be read: %w", err))
	}
}

func (w *cursorWire) setError(err error) {
	w.mu.Lock()
	if w.err == nil {
		w.err = err
	}
	w.mu.Unlock()
}

func (w *cursorWire) readError() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.err
}

func (w *cursorWire) send(ctx context.Context, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if len(encoded) > 1024*1024 {
		return fmt.Errorf("Cursor input exceeds one megabyte")
	}
	encoded = append(encoded, '\n')
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	completed := make(chan error, 1)
	go func() {
		_, err := w.stdin.Write(encoded)
		completed <- err
	}()
	select {
	case err := <-completed:
		return err
	case <-ctx.Done():
		w.stop()
		return ctx.Err()
	case <-w.processDone:
		return fmt.Errorf("Cursor shim stopped before accepting input")
	}
}

func (w *cursorWire) stop() {
	w.stopOnce.Do(func() {
		_ = w.stdin.Close()
		go func() {
			select {
			case <-w.processDone:
				return
			case <-time.After(time.Second):
				_ = syscall.Kill(-w.cmd.Process.Pid, syscall.SIGTERM)
			}
			select {
			case <-w.processDone:
			case <-time.After(2 * time.Second):
				_ = syscall.Kill(-w.cmd.Process.Pid, syscall.SIGKILL)
			}
		}()
	})
}

func cursorStateDir(dataDir string) string { return filepath.Join(dataDir, "cursor-state") }
