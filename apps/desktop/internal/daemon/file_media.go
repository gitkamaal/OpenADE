package daemon

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

func (d *Daemon) handleFileMedia(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	root, err := os.OpenRoot(session.WorktreePath)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	defer root.Close()
	path, err := editorPath(root, r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, 400, err)
		return
	}
	file, err := root.Open(path)
	if err != nil {
		writeError(w, 404, fmt.Errorf("image not found"))
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxAttachmentBytes {
		writeError(w, 400, fmt.Errorf("choose an image up to 24 MiB"))
		return
	}
	header := make([]byte, 512)
	n, _ := file.Read(header)
	mime := http.DetectContentType(header[:n])
	if !strings.HasPrefix(mime, "image/") || mime == "image/svg+xml" {
		writeError(w, 400, fmt.Errorf("file is not a supported raster image"))
		return
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		writeError(w, 500, err)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, path, info.ModTime(), file)
}
