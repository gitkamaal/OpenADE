package daemon

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/google/uuid"
)

const maxAttachmentBytes = 24 * 1024 * 1024

type Attachment struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
	MIME string `json:"mime"`
	Size int    `json:"size"`
}

func (d *Daemon) handleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxAttachmentBytes))
	if err != nil {
		writeError(w, 413, fmt.Errorf("image exceeds 24 MiB"))
		return
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 64_000_000 {
		writeError(w, 400, fmt.Errorf("choose a valid PNG, JPEG or GIF image up to 64 megapixels"))
		return
	}
	ext := map[string]string{"png": ".png", "jpeg": ".jpg", "gif": ".gif"}[format]
	if ext == "" {
		writeError(w, 400, fmt.Errorf("unsupported image format"))
		return
	}
	name := filepath.Base(r.URL.Query().Get("name"))
	name = strings.Map(func(c rune) rune {
		if unicode.IsControl(c) {
			return -1
		}
		return c
	}, name)
	if name == "." || name == "" || len(name) > 256 {
		name = "Image" + ext
	}
	d.attachmentMu.Lock()
	defer d.attachmentMu.Unlock()
	folder := filepath.Join(d.config.DataDir, "attachments")
	if err = os.MkdirAll(folder, 0700); err != nil {
		writeError(w, 500, err)
		return
	}
	// A profile quota bounds immutable staged images without deleting a user's
	// sent attachments or treating successful upload as permission to send.
	entries, err := os.ReadDir(folder)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	var total int64
	for _, entry := range entries {
		if info, e := entry.Info(); e == nil {
			total += info.Size()
		}
	}
	if total+int64(len(data)) > 512*1024*1024 {
		writeError(w, 413, fmt.Errorf("attachment library exceeds 512 MiB"))
		return
	}
	id := uuid.NewString()
	path := filepath.Join(folder, id+ext)
	if err = os.WriteFile(path, data, 0600); err != nil {
		writeError(w, 500, err)
		return
	}
	attachment := Attachment{ID: id, Name: name, Path: path, MIME: "image/" + format, Size: len(data)}
	metadata, _ := json.Marshal(attachment)
	if err = os.WriteFile(filepath.Join(folder, id+".json"), metadata, 0600); err != nil {
		_ = os.Remove(path)
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 201, attachment)
}

func (d *Daemon) handleAttachmentMedia(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		writeError(w, 400, fmt.Errorf("invalid attachment"))
		return
	}
	folder := filepath.Join(d.config.DataDir, "attachments")
	data, err := os.ReadFile(filepath.Join(folder, id+".json"))
	if err != nil {
		writeError(w, 404, fmt.Errorf("image not found"))
		return
	}
	var attachment Attachment
	if json.Unmarshal(data, &attachment) != nil || attachment.ID != id || filepath.Dir(attachment.Path) != folder {
		writeError(w, 404, fmt.Errorf("image not found"))
		return
	}
	root, err := os.OpenRoot(folder)
	if err != nil {
		writeError(w, 404, fmt.Errorf("image not found"))
		return
	}
	defer root.Close()
	name := filepath.Base(attachment.Path)
	linkInfo, err := root.Lstat(name)
	if err != nil || linkInfo.Mode()&os.ModeSymlink != 0 {
		writeError(w, 404, fmt.Errorf("image not found"))
		return
	}
	file, err := root.Open(name)
	if err != nil {
		writeError(w, 404, fmt.Errorf("image not found"))
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeError(w, 404, fmt.Errorf("image not found"))
		return
	}
	w.Header().Set("Content-Type", attachment.MIME)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, attachment.Name, info.ModTime(), file)
}
