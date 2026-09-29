package daemon

import (
	"net/http"
	"runtime"
	"sync/atomic"
)

func (d *Daemon) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	sessions, terminals, clients := 0, 0, 0
	d.sessions.mu.RLock()
	sessions = len(d.sessions.live)
	for _, live := range d.sessions.live {
		live.mu.Lock()
		clients += len(live.subscribers)
		live.mu.Unlock()
	}
	d.sessions.mu.RUnlock()
	d.terminals.mu.Lock()
	terminals = len(d.terminals.live)
	for _, live := range d.terminals.live {
		live.mu.Lock()
		clients += len(live.subscribers)
		live.mu.Unlock()
	}
	d.terminals.mu.Unlock()
	d.sessions.providerMu.Lock()
	providers := len(d.sessions.codex) + len(d.sessions.acp) + len(d.sessions.cursor)
	d.sessions.providerMu.Unlock()
	d.activityMu.Lock()
	activityClients := len(d.activityClients)
	d.activityMu.Unlock()
	fileRoots, fileSubscribers, fileDirs := 0, 0, 0
	if d.fileWatches != nil {
		fileRoots, fileSubscribers, fileDirs = d.fileWatches.stats()
	}
	writeJSON(w, 200, map[string]any{"provider_connections": providers, "heap_bytes": memory.HeapAlloc, "system_bytes": memory.Sys, "goroutines": runtime.NumGoroutine(), "live_sessions": sessions, "live_terminals": terminals, "stream_clients": clients, "activity_clients": activityClients, "activity_polls": atomic.LoadInt64(&d.activityPolls), "file_watch_roots": fileRoots, "file_watch_subscribers": fileSubscribers, "file_watch_dirs": fileDirs})
}
