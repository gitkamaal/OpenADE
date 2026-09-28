package daemon

import (
	"context"
	"fmt"
	"sync"
)

// deletionFence closes admission before teardown. Existing launch leases finish
// before removal stops the resources they created; no mutex is held while wait.
type deletionFence struct {
	mu      sync.Mutex
	entries map[string]*deletionEntry
}
type deletionEntry struct {
	deleting   bool
	admissions int
	drained    chan struct{}
}

func newDeletionFence() *deletionFence { return &deletionFence{entries: map[string]*deletionEntry{}} }
func (f *deletionFence) admit(id string) (func(), error) {
	f.mu.Lock()
	entry := f.entries[id]
	if entry != nil && entry.deleting {
		f.mu.Unlock()
		return nil, fmt.Errorf("chat is being removed")
	}
	if entry == nil {
		entry = &deletionEntry{}
		f.entries[id] = entry
	}
	entry.admissions++
	f.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			f.mu.Lock()
			entry.admissions--
			if entry.deleting && entry.admissions == 0 {
				close(entry.drained)
			}
			if !entry.deleting && entry.admissions == 0 {
				delete(f.entries, id)
			}
			f.mu.Unlock()
		})
	}, nil
}
func (f *deletionFence) begin(ctx context.Context, ids []string) (func(), error) {
	f.mu.Lock()
	unique := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if id != "" && !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	for _, id := range unique {
		if entry := f.entries[id]; entry != nil && entry.deleting {
			f.mu.Unlock()
			return nil, fmt.Errorf("chat is already being removed")
		}
	}
	waits := make([]chan struct{}, 0, len(unique))
	for _, id := range unique {
		entry := f.entries[id]
		if entry == nil {
			entry = &deletionEntry{}
			f.entries[id] = entry
		}
		if entry.deleting {
			f.mu.Unlock()
			return nil, fmt.Errorf("chat is already being removed")
		}
		entry.deleting = true
		entry.drained = make(chan struct{})
		if entry.admissions == 0 {
			close(entry.drained)
		}
		waits = append(waits, entry.drained)
	}
	f.mu.Unlock()
	for _, wait := range waits {
		select {
		case <-wait:
		case <-ctx.Done():
			f.mu.Lock()
			for _, id := range unique {
				entry := f.entries[id]
				if entry == nil {
					continue
				}
				entry.deleting = false
				entry.drained = nil
				if entry.admissions == 0 {
					delete(f.entries, id)
				}
			}
			f.mu.Unlock()
			return nil, ctx.Err()
		}
	}
	return func() {
		f.mu.Lock()
		for _, id := range unique {
			delete(f.entries, id)
		}
		f.mu.Unlock()
	}, nil
}
