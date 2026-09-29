package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
	"time"
)

func TestWorkspaceSearchPlainFolderBoundsResultsAndFindsEmptyDirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "needle"), 0o700); err != nil {
		t.Fatal(err)
	}
	for index := range 250 {
		name := fmt.Sprintf("needle-%03d.txt", index)
		if err := os.WriteFile(filepath.Join(root, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	results, truncated, err := searchWorkspaceFiles(context.Background(), root, "needle", false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != workspaceSearchLimit || !truncated {
		t.Fatalf("expected %d ranked results with truncation, got %d and %t", workspaceSearchLimit, len(results), truncated)
	}
	if results[0].Path != "needle" || results[0].Kind != "directory" {
		t.Fatalf("expected exact directory match first, got %+v", results[0])
	}
	foundDirectory := false
	for _, item := range results {
		if item.Path == "needle" && item.Kind == "directory" {
			foundDirectory = true
			break
		}
	}
	if !foundDirectory {
		t.Fatal("empty directory was omitted from ranked results")
	}
	for index := 1; index < len(results); index++ {
		if searchMatchBetter(results[index], results[index-1]) {
			t.Fatalf("results out of score order at %d", index)
		}
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := searchWorkspaceFiles(canceled, root, "needle", false, false); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled search returned %v", err)
	}
}

func TestWorkspaceSearchGitHonorsIgnoredAndIncludesUntrackedDirectories(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
	root := t.TempDir()
	command := exec.Command("git", "-C", root, "init", "-q")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git init: %s: %v", output, err)
	}
	for name, data := range map[string]string{
		".gitignore":         "ignored-needle.txt\n",
		"needle.txt":         "visible\n",
		"ignored-needle.txt": "ignored\n",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "needle-empty-folder"), 0o700); err != nil {
		t.Fatal(err)
	}
	visible, _, err := searchWorkspaceFiles(context.Background(), root, "needle", false, false)
	if err != nil {
		t.Fatal(err)
	}
	paths := make([]string, len(visible))
	for index, item := range visible {
		paths[index] = item.Path
	}
	if !slices.Contains(paths, "needle.txt") || !slices.Contains(paths, "needle-empty-folder") || slices.Contains(paths, "ignored-needle.txt") {
		t.Fatalf("unexpected default search paths: %v", paths)
	}
	all, _, err := searchWorkspaceFiles(context.Background(), root, "needle", true, true)
	if err != nil {
		t.Fatal(err)
	}
	paths = paths[:0]
	for _, item := range all {
		paths = append(paths, item.Path)
	}
	if !slices.Contains(paths, "ignored-needle.txt") {
		t.Fatalf("show-all search omitted ignored file: %v", paths)
	}
}

func TestGitFileSearchCancellationReapsProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture requires Unix")
	}
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "git"), []byte("#!/bin/sh\nexec sleep 30\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	err := eachGitSearchPath(ctx, t.TempDir(), []string{"-z"}, func(string) error { return nil })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected canceled git search, got %v", err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("git child did not stop promptly: %s", elapsed)
	}
}
