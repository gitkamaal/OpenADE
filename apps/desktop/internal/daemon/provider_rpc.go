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
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// Codex and ACP both use newline-framed JSON-RPC over a private child pipe.
// Responses bypass the event consumer so a server request can be answered
// while a client request is awaiting its response.
const maxProviderFrameBytes = 8 * 1024 * 1024

type providerRPCFrame struct {
	JSONRPC  string            `json:"jsonrpc,omitempty"`
	ID       json.RawMessage   `json:"id,omitempty"`
	Method   string            `json:"method,omitempty"`
	Params   json.RawMessage   `json:"params,omitempty"`
	Result   json.RawMessage   `json:"result,omitempty"`
	Error    *providerRPCError `json:"error,omitempty"`
	sequence uint64
}

type providerRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *providerRPCError) Error() string { return e.Message }

type providerRPCResult struct {
	value   json.RawMessage
	err     error
	through uint64
}

type providerRPC struct {
	emitVersion   bool
	cmd           *exec.Cmd
	stdin         *os.File
	writeGate     chan struct{}
	mu            sync.Mutex
	pending       map[string]chan providerRPCResult
	closed        bool
	closeErr      error
	done          chan struct{}
	readDone      chan struct{}
	processDone   chan struct{}
	events        chan providerRPCFrame
	eventBytes    atomic.Int64
	nextID        atomic.Uint64
	eventSequence uint64
	stopOnce      sync.Once
}

func startProviderRPC(program string, args []string, session Session, emitVersion bool) (*providerRPC, error) {
	cmd := exec.Command(program, args...)
	cmd.Dir = session.WorktreePath
	cmd.Env = processEnvironment("OPENADE_SESSION_ID=" + session.ID)
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
	// Provider stderr may contain account/configuration details. Do not copy
	// it into a transcript or diagnostic response.
	cmd.Stdout = stdoutWriter
	cmd.Stderr = io.Discard
	if err = cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stdoutWriter.Close()
		return nil, err
	}
	_ = stdoutWriter.Close()
	rpc := &providerRPC{emitVersion: emitVersion, cmd: cmd, stdin: stdin.(*os.File), writeGate: make(chan struct{}, 1),
		pending: make(map[string]chan providerRPCResult), done: make(chan struct{}),
		readDone: make(chan struct{}), processDone: make(chan struct{}), events: make(chan providerRPCFrame, 256)}
	go rpc.read(stdout)
	go func() {
		// This is our pipe, so Wait cannot close it before its final frames
		// drain. Release orphaned writers if the leader has already exited.
		_ = cmd.Wait()
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		select {
		case <-rpc.readDone:
		case <-time.After(time.Second):
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			_ = stdout.Close()
			<-rpc.readDone
		}
		close(rpc.processDone)
	}()
	return rpc, nil
}

func (r *providerRPC) read(stdout io.ReadCloser) {
	defer close(r.readDone)
	defer close(r.events)
	defer stdout.Close()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 32*1024), maxProviderFrameBytes)
	for scanner.Scan() {
		line := scanner.Bytes()
		var frame providerRPCFrame
		if err := json.Unmarshal(line, &frame); err != nil {
			r.fail(fmt.Errorf("provider emitted an invalid protocol frame"))
			r.stop()
			return
		}
		if frame.Method == "" {
			key := string(frame.ID)
			r.mu.Lock()
			ch := r.pending[key]
			delete(r.pending, key)
			r.mu.Unlock()
			if ch != nil {
				result := providerRPCResult{value: frame.Result, through: r.eventSequence}
				if frame.Error != nil {
					result.err = frame.Error
				}
				ch <- result
			}
			continue
		}
		r.eventSequence++
		frame.sequence = r.eventSequence
		// Bound both count and retained bytes; 256 maximum-size frames must
		// not reserve gigabytes. Overflow fails visibly instead of losing events.
		bytes := int64(len(frame.Params) + len(frame.ID) + len(frame.Method))
		if r.eventBytes.Add(bytes) > maxProviderFrameBytes {
			r.eventBytes.Add(-bytes)
			r.fail(errors.New("provider event buffer exceeded its limit"))
			r.stop()
			return
		}
		select {
		case r.events <- frame:
		default:
			r.eventBytes.Add(-bytes)
			r.fail(errors.New("provider event buffer exceeded its limit"))
			r.stop()
			return
		}
	}
	err := scanner.Err()
	if err == nil {
		err = io.EOF
	}
	r.fail(err)
}

func (r *providerRPC) consume(frame providerRPCFrame) {
	r.eventBytes.Add(-int64(len(frame.Params) + len(frame.ID) + len(frame.Method)))
}

func (r *providerRPC) fail(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	r.closed = true
	r.closeErr = err
	for key, ch := range r.pending {
		ch <- providerRPCResult{err: err}
		delete(r.pending, key)
	}
	close(r.done)
}

func (r *providerRPC) request(ctx context.Context, method string, params any) (json.RawMessage, error) {
	value, _, err := r.requestWithSequence(ctx, method, params)
	return value, err
}

// beginRequest confirms that the entire frame reached the private pipe before
// returning. ACP prompts finish only when their eventual response arrives, so
// callers must not block the HTTP create/send request on that response.
func (r *providerRPC) beginRequest(ctx context.Context, method string, params any) (<-chan providerRPCResult, func(), error) {
	id := r.nextID.Add(1)
	idBytes, _ := json.Marshal(id)
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return nil, nil, err
	}
	ch := make(chan providerRPCResult, 1)
	key := string(idBytes)
	r.mu.Lock()
	if r.closed {
		err = r.closeErr
		r.mu.Unlock()
		return nil, nil, err
	}
	if len(r.pending) >= 32 {
		r.mu.Unlock()
		return nil, nil, errors.New("too many pending provider requests")
	}
	r.pending[key] = ch
	r.mu.Unlock()
	cancel := func() { r.mu.Lock(); delete(r.pending, key); r.mu.Unlock() }
	if err = r.write(ctx, providerRPCFrame{JSONRPC: "2.0", ID: idBytes, Method: method, Params: paramsBytes}); err != nil {
		cancel()
		return nil, nil, err
	}
	return ch, cancel, nil
}

func (r *providerRPC) requestWithSequence(ctx context.Context, method string, params any) (json.RawMessage, uint64, error) {
	id := r.nextID.Add(1)
	idBytes, _ := json.Marshal(id)
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return nil, 0, err
	}
	ch := make(chan providerRPCResult, 1)
	key := string(idBytes)
	r.mu.Lock()
	if r.closed {
		err = r.closeErr
		r.mu.Unlock()
		return nil, 0, err
	}
	if len(r.pending) >= 32 {
		r.mu.Unlock()
		return nil, 0, errors.New("too many pending provider requests")
	}
	r.pending[key] = ch
	r.mu.Unlock()
	defer func() { r.mu.Lock(); delete(r.pending, key); r.mu.Unlock() }()
	if err = r.write(ctx, providerRPCFrame{JSONRPC: "2.0", ID: idBytes, Method: method, Params: paramsBytes}); err != nil {
		return nil, 0, err
	}
	select {
	case result := <-ch:
		return result.value, result.through, result.err
	case <-ctx.Done():
		return nil, 0, ctx.Err()
	case <-r.done:
		// A valid response immediately followed by EOF still acknowledges
		// the request. Do not randomly discard it in this select race.
		select {
		case result := <-ch:
			return result.value, result.through, result.err
		default:
			r.mu.Lock()
			err = r.closeErr
			r.mu.Unlock()
			return nil, 0, err
		}
	}
}

func (r *providerRPC) notify(ctx context.Context, method string, params any) error {
	data, err := json.Marshal(params)
	if err != nil {
		return err
	}
	return r.write(ctx, providerRPCFrame{JSONRPC: "2.0", Method: method, Params: data})
}

func (r *providerRPC) respond(ctx context.Context, id json.RawMessage, result any) error {
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return r.write(ctx, providerRPCFrame{JSONRPC: "2.0", ID: id, Result: data})
}

func (r *providerRPC) reject(ctx context.Context, id json.RawMessage, code int, message string) error {
	return r.write(ctx, providerRPCFrame{JSONRPC: "2.0", ID: id, Error: &providerRPCError{Code: code, Message: message}})
}

func (r *providerRPC) write(ctx context.Context, frame providerRPCFrame) error {
	if r.emitVersion {
		frame.JSONRPC = "2.0"
	} else {
		frame.JSONRPC = ""
	}
	data, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	if len(data) > maxProviderFrameBytes {
		return errors.New("provider request exceeded its limit")
	}
	select {
	case r.writeGate <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	case <-r.done:
		return errors.New("provider connection is closed")
	}
	defer func() { <-r.writeGate }()
	deadline := time.Now().Add(3 * time.Second)
	if when, ok := ctx.Deadline(); ok && when.Before(deadline) {
		deadline = when
	}
	if err = r.stdin.SetWriteDeadline(deadline); err != nil {
		return err
	}
	_, err = r.stdin.Write(append(data, '\n'))
	_ = r.stdin.SetWriteDeadline(time.Time{})
	if err != nil {
		r.fail(errors.New("provider input pipe failed"))
		r.stop()
	}
	return err
}

func (r *providerRPC) stop() {
	r.stopOnce.Do(func() {
		_ = r.stdin.Close()
		_ = syscall.Kill(-r.cmd.Process.Pid, syscall.SIGTERM)
		go func() {
			select {
			case <-r.processDone:
			case <-time.After(2 * time.Second):
				_ = syscall.Kill(-r.cmd.Process.Pid, syscall.SIGKILL)
			}
		}()
	})
}
