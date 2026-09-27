package daemon

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func (d *Daemon) handleProviderState(w http.ResponseWriter, r *http.Request) {
	if _, err := d.store.GetSession(r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, d.sessions.providerState(r.PathValue("id")))
}
func (d *Daemon) handleProviderReply(w http.ResponseWriter, r *http.Request) {
	var body providerReply
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&body); err != nil {
		writeError(w, 400, fmt.Errorf("invalid reply"))
		return
	}
	c := d.sessions.codexClient(r.PathValue("id"))
	if c == nil {
		writeError(w, 409, fmt.Errorf("this request is no longer active"))
		return
	}
	if err := c.reply(r.PathValue("requestID"), body); err != nil {
		writeError(w, 409, err)
		return
	}
	w.WriteHeader(204)
}
