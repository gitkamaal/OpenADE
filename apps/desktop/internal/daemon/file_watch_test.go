package daemon

import (
	"errors"
	"fmt"
	"os"
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
	first, cancelFirst, err := hub.subscribe(root)
	if err != nil {
		t.Fatal(err)
	}
	second, cancelSecond, err := hub.subscribe(root)
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

func TestFileWatchFallsBackWhenEntryBudgetIsExceeded(t *testing.T) {
	root := t.TempDir()
	for index := 0; index <= fileWatchEntryLimit; index++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("file-%05d", index)), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := watchDirectories(root); !errors.Is(err, errFileWatchBudget) {
		t.Fatalf("expected entry budget, got %v", err)
	}
	hub := newFileWatchHub()
	events, cancel, err := hub.subscribe(root)
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
	if _, _, err := hub.subscribe(root); err == nil {
		t.Fatal("closed hub accepted a subscriber")
	}
}
