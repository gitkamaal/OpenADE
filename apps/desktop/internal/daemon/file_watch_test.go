package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestFileWatchSharesCheckoutAndReleasesLastSubscriber(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "src")
	if err := os.Mkdir(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	hub := newFileWatchHub()
	defer hub.close()
	first, cancelFirst, err := hub.subscribe(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	second, cancelSecond, err := hub.subscribe(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if roots, subscribers, dirs := hub.stats(); roots != 1 || subscribers != 2 || dirs < 2 {
		t.Fatalf("unexpected shared watch: roots=%d subscribers=%d dirs=%d", roots, subscribers, dirs)
	}
	if err := os.WriteFile(filepath.Join(nested, "live.md"), []byte("live"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, events := range []<-chan struct{}{first, second} {
		select {
		case _, open := <-events:
			if !open {
				t.Fatal("watch closed before its event")
			}
		case <-time.After(3 * time.Second):
			t.Fatal("native file event was not delivered")
		}
	}
	cancelFirst()
	if roots, subscribers, _ := hub.stats(); roots != 1 || subscribers != 1 {
		t.Fatalf("first close removed shared watch: roots=%d subscribers=%d", roots, subscribers)
	}
	cancelSecond()
	cancelSecond()
	if roots, subscribers, dirs := hub.stats(); roots != 0 || subscribers != 0 || dirs != 0 {
		t.Fatalf("last close retained watch: roots=%d subscribers=%d dirs=%d", roots, subscribers, dirs)
	}
}

func TestFileWatchConcurrentSubscribersShareOneNativeRoot(t *testing.T) {
	root := t.TempDir()
	hub := newFileWatchHub()
	defer hub.close()
	type subscription struct {
		cancel func()
		err    error
	}
	const count = 8
	start := make(chan struct{})
	results := make(chan subscription, count)
	for range count {
		go func() {
			<-start
			_, cancel, err := hub.subscribe(context.Background(), root)
			results <- subscription{cancel: cancel, err: err}
		}()
	}
	close(start)
	stops := make([]func(), 0, count)
	for range count {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		stops = append(stops, result.cancel)
	}
	if roots, subscribers, dirs := hub.stats(); roots != 1 || subscribers != count || dirs != 1 {
		t.Fatalf("parallel subscriptions made extra native watches: roots=%d subscribers=%d dirs=%d", roots, subscribers, dirs)
	}
	for _, stop := range stops {
		stop()
	}
	if roots, subscribers, dirs := hub.stats(); roots != 0 || subscribers != 0 || dirs != 0 {
		t.Fatalf("parallel subscriptions leaked a watch: roots=%d subscribers=%d dirs=%d", roots, subscribers, dirs)
	}
}

func TestFileWatchFallsBackWhenEntryBudgetIsExceeded(t *testing.T) {
	root := t.TempDir()
	for index := 0; index <= fileWatchEntryLimit; index++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("file-%05d", index)), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := watchDirectories(root, nil); !errors.Is(err, errFileWatchBudget) {
		t.Fatalf("expected entry budget, got %v", err)
	}
	hub := newFileWatchHub()
	events, cancel, err := hub.subscribe(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if events == nil {
		t.Fatal("repair-only watch has no subscriber")
	}
	if roots, subscribers, dirs := hub.stats(); roots != 1 || subscribers != 1 || dirs != 0 {
		t.Fatalf("over-budget tree opened native watches: roots=%d subscribers=%d dirs=%d", roots, subscribers, dirs)
	}
	cancel()
	hub.close()
	if _, _, err := hub.subscribe(context.Background(), root); err == nil {
		t.Fatal("closed hub accepted a subscriber")
	}
}

func TestFileWatchKeepsVisibleGitTreeLiveBesideLargeIgnoredDependencies(t *testing.T) {
	root := t.TempDir()
	if output, err := exec.Command("git", "-C", root, "init", "-b", "main").CombinedOutput(); err != nil {
		t.Fatalf("initialize fixture: %s: %v", output, err)
	}
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("node_modules/\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(root, "src")
	ignored := filepath.Join(root, "node_modules")
	for _, dir := range []string{src, ignored} {
		if err := os.Mkdir(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for index := 0; index <= fileWatchEntryLimit; index++ {
		if err := os.WriteFile(filepath.Join(ignored, fmt.Sprintf("dependency-%05d", index)), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	hub := newFileWatchHub()
	defer hub.close()
	events, cancel, err := hub.subscribe(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	if roots, subscribers, dirs := hub.stats(); roots != 1 || subscribers != 1 || dirs < 2 {
		t.Fatalf("ignored dependency tree disabled the visible native watch: roots=%d subscribers=%d dirs=%d", roots, subscribers, dirs)
	}
	if err := os.WriteFile(filepath.Join(src, "live.md"), []byte("visible"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case _, open := <-events:
		if !open {
			t.Fatal("watch closed before visible change")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("visible file change was not delivered")
	}
}

func TestFileWatchKeepsPlainFolderLiveBesideUnlistedDependencies(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "src")
	dependencies := filepath.Join(root, "node_modules")
	for _, dir := range []string{src, dependencies} {
		if err := os.Mkdir(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for index := 0; index <= fileWatchEntryLimit; index++ {
		if err := os.WriteFile(filepath.Join(dependencies, fmt.Sprintf("dependency-%05d", index)), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	hub := newFileWatchHub()
	defer hub.close()
	events, cancel, err := hub.subscribe(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	if roots, subscribers, dirs := hub.stats(); roots != 1 || subscribers != 1 || dirs < 2 {
		t.Fatalf("unlisted dependency tree disabled the plain-folder watch: roots=%d subscribers=%d dirs=%d", roots, subscribers, dirs)
	}
	if err := os.WriteFile(filepath.Join(src, "live.md"), []byte("visible"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case _, open := <-events:
		if !open {
			t.Fatal("watch closed before plain-folder change")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("plain-folder file change was not delivered")
	}
}
