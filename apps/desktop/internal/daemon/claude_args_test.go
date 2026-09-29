package daemon

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestClaudePrintArgsUsesForwardFlagOnlyWhenAdvertised(t *testing.T) {
	for _, tc := range []struct {
		name      string
		help      string
		forwarded bool
	}{
		{"new CLI", "--forward-subagent-text\n", true},
		{"older CLI", "--include-partial-messages\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program := filepath.Join(t.TempDir(), "claude")
			if err := os.WriteFile(program, []byte("#!/bin/sh\nprintf '%s' '"+tc.help+"'\n"), 0700); err != nil {
				t.Fatal(err)
			}
			args := claudePrintArgs(program, []string{"--resume", "conversation-id"})
			if got := slices.Contains(args, "--forward-subagent-text"); got != tc.forwarded {
				t.Fatalf("forward flag=%t, want %t: %v", got, tc.forwarded, args)
			}
			if !slices.Contains(args, "stream-json") || !slices.Contains(args, "--permission-prompt-tool") || slices.Contains(args, "Continue") {
				t.Fatalf("Claude structured run must use stdin and the control bridge: %v", args)
			}
		})
	}
}
