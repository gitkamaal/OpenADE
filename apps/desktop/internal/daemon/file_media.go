package daemon

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"os"
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
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		writeError(w, 500, err)
		return
	}
	// Go's image decoders do not include ICO; retain the existing icon preview path.
	if http.DetectContentType(header[:n]) == "image/vnd.microsoft.icon" {
		w.Header().Set("Content-Type", "image/vnd.microsoft.icon")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "private, no-store")
		http.ServeContent(w, r, path, info.ModTime(), io.NewSectionReader(file, 0, info.Size()))
		return
	}
	config, format, err := image.DecodeConfig(io.LimitReader(file, maxAttachmentBytes+1))
	mime := map[string]string{"png": "image/png", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp", "tiff": "image/tiff"}[format]
	if err != nil || mime == "" || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 64_000_000 {
		writeError(w, 400, fmt.Errorf("file is not a supported raster image"))
		return
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		writeError(w, 500, err)
		return
	}
	var media io.ReadSeeker = io.NewSectionReader(file, 0, info.Size())
	if format == "bmp" || format == "tiff" {
		data, readErr := io.ReadAll(io.LimitReader(file, maxAttachmentBytes+1))
		if readErr != nil || len(data) > maxAttachmentBytes {
			writeError(w, 400, fmt.Errorf("choose an image up to 24 MiB"))
			return
		}
		decoded, _, decodeErr := image.Decode(bytes.NewReader(data))
		if decodeErr != nil {
			writeError(w, 400, fmt.Errorf("image cannot be decoded"))
			return
		}
		encoded := &boundedAttachmentWriter{}
		if encodeErr := png.Encode(encoded, decoded); encodeErr != nil {
			writeError(w, 400, fmt.Errorf("image cannot be converted within the 24 MiB limit"))
			return
		}
		media = bytes.NewReader(encoded.Bytes())
		mime = "image/png"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, path, info.ModTime(), media)
}
