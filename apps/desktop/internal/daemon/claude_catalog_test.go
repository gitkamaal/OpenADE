package daemon

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestClaudeInitializeTimeoutReapsDescendants(t *testing.T) {
	program := filepath.Join(t.TempDir(), "claude")
	if err := os.WriteFile(program, []byte("#!/bin/sh\nsleep 30 &\nwait\n"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := probeClaudeModels(ctx, program); err == nil {
		t.Fatal("an unanswered initialize must fail")
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("Claude initialize exceeded its bounded cancellation: %s", elapsed)
	}
}
