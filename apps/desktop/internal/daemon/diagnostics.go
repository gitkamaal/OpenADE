package daemon

import (
	"net/http"
	"runtime"
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
	providers := len(d.sessions.codex)
	d.sessions.providerMu.Unlock()
	writeJSON(w, 200, map[string]any{"provider_connections": providers, "heap_bytes": memory.HeapAlloc, "system_bytes": memory.Sys, "goroutines": runtime.NumGoroutine(), "live_sessions": sessions, "live_terminals": terminals, "stream_clients": clients})
}
