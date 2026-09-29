package daemon

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestCursorNodeVersionGate(t *testing.T) {
	for _, version := range []struct {
		name      string
		supported bool
	}{{"v21.9.0", false}, {"v22.12.0", false}, {"v22.13.0", true}, {"v23.0.0", true}} {
		path := filepath.Join(t.TempDir(), "node")
		if err := os.WriteFile(path, []byte("#!/bin/sh\nprintf '%s\\n' '"+version.name+"'\n"), 0o700); err != nil {
			t.Fatal(err)
		}
		err := checkCursorNode(path)
		if (err == nil) != version.supported {
			t.Errorf("Node %s supported=%t, error=%v", version.name, version.supported, err)
		}
	}
}

// Run explicitly with OPENADE_CURSOR_INSTALL_SMOKE=1 to verify the pinned
// public npm artifact and the installed shim without using a Cursor account.
func TestCursorInstallSmoke(t *testing.T) {
	if os.Getenv("OPENADE_CURSOR_INSTALL_SMOKE") != "1" {
		t.Skip("requires an explicit networked SDK install smoke run")
	}
	if os.Getenv("OPENADE_CURSOR_SHIM_EXECUTABLE") != "" {
		t.Fatal("remove the synthetic shim override for the install smoke run")
	}
	m := &SessionManager{dataDir: t.TempDir()}
	stale, err := cursorInstallDir(m.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(stale, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stale, ".openade-install-ok"), []byte("incomplete\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	program, args, err := m.resolveCursorRuntime(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(args) != 1 || filepath.Base(args[0]) != "shim.mjs" {
		t.Fatalf("unexpected Cursor launch plan: %q %q", program, args)
	}
	if _, ok := cursorShimAt(filepath.Dir(args[0])); !ok {
		t.Fatal("managed Cursor SDK install did not verify")
	}
	check := exec.CommandContext(ctx, program, "--check", args[0])
	if output, err := check.CombinedOutput(); err != nil {
		t.Fatalf("installed Cursor shim syntax check: %v: %s", err, output)
	}
	load := exec.CommandContext(ctx, program, "--input-type=module", "-e", "const sdk = await import('@cursor/sdk'); if (!sdk.Agent || !sdk.Cursor) process.exit(2)")
	load.Dir = filepath.Dir(args[0])
	if output, err := load.CombinedOutput(); err != nil {
		t.Fatalf("installed Cursor SDK import check: %v: %s", err, output)
	}
}
