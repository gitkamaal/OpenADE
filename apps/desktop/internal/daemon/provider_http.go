package daemon

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func (d *Daemon) handleProviderState(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, d.sessions.providerState(session))
}
func (d *Daemon) handleProviderReply(w http.ResponseWriter, r *http.Request) {
	var body providerReply
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&body); err != nil {
		writeError(w, 400, fmt.Errorf("invalid reply"))
		return
	}
	c := d.sessions.codexClient(r.PathValue("id"))
	a := d.sessions.acpClient(r.PathValue("id"))
	claude := d.sessions.claudeClient(r.PathValue("id"))
	if c == nil && a == nil && claude == nil {
		writeError(w, 409, fmt.Errorf("this request is no longer active"))
		return
	}
	var err error
	if c != nil {
		err = c.reply(r.PathValue("requestID"), body)
	} else if a != nil {
		err = a.reply(r.PathValue("requestID"), body)
	} else {
		err = claude.reply(r.PathValue("requestID"), body)
	}
	if err != nil {
		writeError(w, 409, err)
		return
	}
	w.WriteHeader(204)
}
