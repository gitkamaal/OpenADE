package daemon

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// kqueue may hold descriptors for entries inside each watched directory.
// Large trees use the same low-frequency repair path as a failed native watch.
const (
	fileWatchDirLimit       = 256
	fileWatchEntryLimit     = 4096
	fileWatchDebounce       = 100 * time.Millisecond
	fileWatchRepairInterval = 120 * time.Second
)

var errFileWatchBudget = errors.New("workspace exceeds the native file watch budget")

type fileWatchHub struct {
	mu      sync.Mutex
	watches map[string]*fileWatch
	closed  bool
}

type fileWatch struct {
	root         string
	ignored      map[string]struct{} // owned by run after startup
	watcher      *fsnotify.Watcher
	nativeActive bool                       // owned by run after startup
	dirs         map[string]struct{}        // owned by run after startup
	subscribers  map[chan struct{}]struct{} // guarded by hub.mu
	stop         chan struct{}
}

func newFileWatchHub() *fileWatchHub {
	return &fileWatchHub{watches: make(map[string]*fileWatch)}
}

func ignoredWatchEntries(ctx context.Context, root string) map[string]struct{} {
	lookup, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	out, err := gitOutput(lookup, root, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z")
	if err != nil {
		return nil
	}
	ignored := make(map[string]struct{})
	for _, entry := range strings.Split(out, "\x00") {
		entry = strings.TrimSuffix(entry, "/")
		if entry == "" || filepath.IsAbs(entry) {
			continue
		}
		path := filepath.Join(root, filepath.FromSlash(entry))
		relative, err := filepath.Rel(root, path)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			continue
		}
		ignored[path] = struct{}{}
	}
	return ignored
}

func watchDirectories(root string, ignored map[string]struct{}) ([]string, error) {
	dirs := make([]string, 0, 32)
	entries := 0
	plain := plainProjectFolder(root)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if path == root {
				return walkErr
			}
			return nil
		}
		if path != root && entry.IsDir() && entry.Name() == ".git" {
			return filepath.SkipDir
		}
		if plain {
			if entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			if path != root && entry.IsDir() {
				relative, err := filepath.Rel(root, path)
				if err != nil {
					return err
				}
				if entry.Name() == "node_modules" || entry.Name() == "target" || len(strings.Split(relative, string(filepath.Separator))) > 16 {
					return filepath.SkipDir
				}
			}
		}
		if _, skip := ignored[path]; skip {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		entries++
		if entries > fileWatchEntryLimit {
			return errFileWatchBudget
		}
		if !entry.IsDir() {
			return nil
		}
		dirs = append(dirs, path)
		if len(dirs) > fileWatchDirLimit {
			return fs.SkipAll
		}
		return nil
	})
	return dirs, err
}

func newFileWatch(root string, ignored map[string]struct{}) *fileWatch {
	watch := &fileWatch{root: root, ignored: ignored, dirs: make(map[string]struct{}), subscribers: make(map[chan struct{}]struct{}), stop: make(chan struct{})}
	dirs, err := watchDirectories(root, ignored)
	if err != nil || len(dirs) > fileWatchDirLimit {
		return watch
	}
	native, err := fsnotify.NewWatcher()
	if err != nil {
		return watch
	}
	for _, dir := range dirs {
		if err = native.Add(dir); err != nil {
			_ = native.Close()
			return watch
		}
		watch.dirs[dir] = struct{}{}
	}
	watch.watcher = native
	watch.nativeActive = true
	return watch
}

func (h *fileWatchHub) subscribe(ctx context.Context, root string) (<-chan struct{}, func(), error) {
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, nil, err
	}
	info, err := os.Stat(canonical)
	if err != nil {
		return nil, nil, err
	}
	if !info.IsDir() {
		return nil, nil, errors.New("workspace root is not a directory")
	}
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return nil, nil, errors.New("file watcher is shutting down")
	}
	watch := h.watches[canonical]
	if watch == nil {
		h.mu.Unlock()
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		candidate := newFileWatch(canonical, ignoredWatchEntries(ctx, canonical))
		if err := ctx.Err(); err != nil {
			if candidate.watcher != nil {
				_ = candidate.watcher.Close()
			}
			return nil, nil, err
		}
		h.mu.Lock()
		if h.closed {
			h.mu.Unlock()
			if candidate.watcher != nil {
				_ = candidate.watcher.Close()
			}
			return nil, nil, errors.New("file watcher is shutting down")
		}
		watch = h.watches[canonical]
		var discard *fsnotify.Watcher
		if watch == nil {
			watch = candidate
			h.watches[canonical] = watch
			go watch.run(h)
		} else {
			discard = candidate.watcher
		}
		changes := make(chan struct{}, 1)
		watch.subscribers[changes] = struct{}{}
		h.mu.Unlock()
		if discard != nil {
			_ = discard.Close()
		}
		return changes, h.cancel(canonical, watch, changes), nil
	}
	changes := make(chan struct{}, 1)
	watch.subscribers[changes] = struct{}{}
	h.mu.Unlock()
	return changes, h.cancel(canonical, watch, changes), nil
}

func (h *fileWatchHub) cancel(canonical string, watch *fileWatch, changes chan struct{}) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			var native *fsnotify.Watcher
			h.mu.Lock()
			if _, exists := watch.subscribers[changes]; exists {
				delete(watch.subscribers, changes)
				close(changes)
			}
			if len(watch.subscribers) == 0 && h.watches[canonical] == watch {
				delete(h.watches, canonical)
				close(watch.stop)
				native = watch.watcher
			}
			h.mu.Unlock()
			if native != nil {
				_ = native.Close()
			}
		})
	}
}

func (h *fileWatchHub) publish(watch *fileWatch) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.watches[watch.root] != watch {
		return
	}
	for subscriber := range watch.subscribers {
		select {
		case subscriber <- struct{}{}:
		default:
		}
	}
}

func (h *fileWatchHub) stats() (roots, subscribers, dirs int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, watch := range h.watches {
		roots++
		subscribers += len(watch.subscribers)
		if watch.watcher != nil {
			dirs += len(watch.watcher.WatchList())
		}
	}
	return
}

func (h *fileWatchHub) close() {
	h.mu.Lock()
	h.closed = true
	watches := h.watches
	h.watches = make(map[string]*fileWatch)
	for _, watch := range watches {
		close(watch.stop)
		for subscriber := range watch.subscribers {
			close(subscriber)
			delete(watch.subscribers, subscriber)
		}
	}
	h.mu.Unlock()
	for _, watch := range watches {
		if watch.watcher != nil {
			_ = watch.watcher.Close()
		}
	}
}

func (watch *fileWatch) syncDirs() {
	if !watch.nativeActive {
		return
	}
	dirs, err := watchDirectories(watch.root, watch.ignored)
	if err != nil || len(dirs) > fileWatchDirLimit {
		watch.ignored = ignoredWatchEntries(context.Background(), watch.root)
		dirs, err = watchDirectories(watch.root, watch.ignored)
	}
	if err != nil || len(dirs) > fileWatchDirLimit {
		_ = watch.watcher.Close()
		watch.nativeActive = false
		watch.dirs = nil
		return
	}
	next := make(map[string]struct{}, len(dirs))
	for _, dir := range dirs {
		next[dir] = struct{}{}
		if _, exists := watch.dirs[dir]; !exists {
			if watch.watcher.Add(dir) != nil {
				_ = watch.watcher.Close()
				watch.nativeActive = false
				watch.dirs = nil
				return
			}
		}
	}
	for dir := range watch.dirs {
		if _, exists := next[dir]; !exists {
			_ = watch.watcher.Remove(dir)
		}
	}
	watch.dirs = next
}

func (watch *fileWatch) run(h *fileWatchHub) {
	repair := time.NewTicker(fileWatchRepairInterval)
	defer repair.Stop()
	var events <-chan fsnotify.Event
	var failures <-chan error
	if watch.nativeActive {
		events, failures = watch.watcher.Events, watch.watcher.Errors
	}
	var debounce *time.Timer
	var fire <-chan time.Time
	needsDirSync := false
	for {
		select {
		case <-watch.stop:
			if debounce != nil {
				debounce.Stop()
			}
			return
		case event, open := <-events:
			if !open {
				events = nil
				continue
			}
			structural := event.Op&(fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0
			_, directory := watch.dirs[event.Name]
			if !structural && !(directory && event.Op&fsnotify.Write != 0) {
				continue
			}
			if structural {
				needsDirSync = true
			}
			if debounce == nil {
				debounce = time.NewTimer(fileWatchDebounce)
				fire = debounce.C
			}
		case _, open := <-failures:
			if !open {
				failures = nil
				continue
			}
			if debounce == nil {
				debounce = time.NewTimer(fileWatchDebounce)
				fire = debounce.C
			}
		case <-fire:
			if needsDirSync {
				watch.syncDirs()
				needsDirSync = false
				if !watch.nativeActive {
					events, failures = nil, nil
				}
			}
			h.publish(watch)
			debounce, fire = nil, nil
		case <-repair.C:
			watch.syncDirs()
			if !watch.nativeActive {
				events, failures = nil, nil
			}
			h.publish(watch)
		}
	}
}
