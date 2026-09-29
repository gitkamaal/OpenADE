package daemon

import (
	"encoding/json"
	"net/http"
	"time"
)

func (d *Daemon) handleListTerminals(w http.ResponseWriter, r *http.Request) {
	if _, err := d.store.GetSession(r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	terminals, err := d.store.ListTerminals(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"terminals": terminals})
}

func (d *Daemon) handleCreateTerminal(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	var body struct {
		Title  string `json:"title"`
		Kind   string `json:"kind"`
		Agent  string `json:"agent"`
		Resume bool   `json:"resume"`
	}
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}
	terminal, err := d.terminals.Create(session, body.Title, TerminalLaunch{Kind: body.Kind, Agent: body.Agent, Resume: body.Resume})
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, terminal)
}

func (d *Daemon) handleTerminalStream(w http.ResponseWriter, r *http.Request) {
	after, err := streamCursor(r)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	initial, output, cancel, err := d.terminals.Subscribe(r.PathValue("id"), after)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		cancel()
		return
	}
	defer conn.Close()
	defer cancel()
	go func() {
		defer cancel()
		for {
			if _, _, err := conn.NextReader(); err != nil {
				return
			}
		}
	}()
	cursor := initial.Cursor
	_ = conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	_ = conn.WriteJSON(map[string]any{"type": "output", "data": string(initial.Data), "replay": true, "reset": initial.Reset || after == 0, "offset": initial.Offset, "cursor": cursor})
	for chunk := range output {
		cursor += int64(len(chunk))
		_ = conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
		if err := conn.WriteJSON(map[string]any{"type": "output", "data": string(chunk), "cursor": cursor}); err != nil {
			return
		}
	}
	terminal, _ := d.store.GetTerminal(r.PathValue("id"))
	_ = conn.WriteJSON(map[string]any{"type": "status", "status": terminal.Status, "exit_code": terminal.ExitCode})
}

func (d *Daemon) handleTerminalInput(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Data string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := d.terminals.Write(r.PathValue("id"), body.Data); err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d *Daemon) handleTerminalResize(w http.ResponseWriter, r *http.Request) {
	var body struct{ Rows, Cols uint16 }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := d.terminals.Resize(r.PathValue("id"), body.Rows, body.Cols); err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d *Daemon) handleTerminalStop(w http.ResponseWriter, r *http.Request) {
	if err := d.terminals.Stop(r.PathValue("id")); err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
