package daemon

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"image/png"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/google/uuid"
	imagedraw "golang.org/x/image/draw"
)

const maxGeneratedImageBytes int64 = 24 * 1024 * 1024
const maxGeneratedSide = 4096
const generatedPreviewSide = 2048
const maxGeneratedSessionBytes int64 = 256 * 1024 * 1024

var generatedIDPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type GeneratedImage struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	MIME string `json:"mime"`
	Size int    `json:"size"`
}

func generatedImageID(sessionID, itemID string) string {
	hash := sha256.Sum256([]byte(sessionID + "\x00" + itemID))
	return hex.EncodeToString(hash[:])
}

func generatedSignature(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "png"
	case bytes.HasPrefix(data, []byte("\xff\xd8\xff")):
		return "jpeg"
	case len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "webp"
	case bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a")):
		return "gif"
	default:
		return ""
	}
}

func staticGeneratedPNG(data []byte) ([]byte, error) {
	signature := generatedSignature(data)
	if signature == "" {
		return nil, fmt.Errorf("unsupported generated image format")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || format != signature || config.Width <= 0 || config.Height <= 0 || config.Width > maxGeneratedSide || config.Height > maxGeneratedSide || int64(config.Width)*int64(config.Height) > 16_000_000 {
		return nil, fmt.Errorf("generated image exceeds decode limits")
	}
	decoded, actual, err := image.Decode(bytes.NewReader(data))
	if err != nil || actual != signature {
		return nil, fmt.Errorf("generated image cannot be decoded")
	}
	if config.Width > generatedPreviewSide || config.Height > generatedPreviewSide {
		scale := math.Min(float64(generatedPreviewSide)/float64(config.Width), float64(generatedPreviewSide)/float64(config.Height))
		width := max(1, int(math.Round(float64(config.Width)*scale)))
		height := max(1, int(math.Round(float64(config.Height)*scale)))
		thumbnail := image.NewRGBA(image.Rect(0, 0, width, height))
		imagedraw.ApproxBiLinear.Scale(thumbnail, thumbnail.Bounds(), decoded, decoded.Bounds(), imagedraw.Src, nil)
		decoded = thumbnail
	}
	encoded := &boundedAttachmentWriter{}
	if err = png.Encode(encoded, decoded); err != nil {
		return nil, fmt.Errorf("generated image exceeds PNG limit")
	}
	return encoded.Bytes(), nil
}

func ensureGeneratedDirectory(path string) error {
	if err := os.Mkdir(path, 0700); err != nil && !os.IsExist(err) {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&0077 != 0 || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("generated image storage is unavailable")
	}
	return nil
}

func (m *SessionManager) generatedImageFolder(sessionID string) string {
	return filepath.Join(m.dataDir, "generated-images", sessionID)
}

func (m *SessionManager) importGeneratedImage(sessionID, itemID, source string) (GeneratedImage, error) {
	if _, err := uuid.Parse(sessionID); err != nil || itemID == "" || len(itemID) > 256 || !filepath.IsAbs(source) {
		return GeneratedImage{}, fmt.Errorf("generated image source is unavailable")
	}
	id := generatedImageID(sessionID, itemID)
	root := filepath.Join(m.dataDir, "generated-images")
	folder := m.generatedImageFolder(sessionID)
	m.generatedImageMu.Lock()
	defer m.generatedImageMu.Unlock()
	if err := ensureGeneratedDirectory(root); err != nil {
		return GeneratedImage{}, err
	}
	if err := ensureGeneratedDirectory(folder); err != nil {
		return GeneratedImage{}, err
	}
	// Even a replay for an existing stable ID must still name a valid current
	// Codex-owned source. Never let an outside path borrow a prior image ID.
	data, err := readGeneratedSource(filepath.Join(codexHome(), "generated_images"), source)
	if err != nil {
		return GeneratedImage{}, err
	}
	target := filepath.Join(folder, id+".png")
	if info, err := os.Lstat(target); err == nil {
		if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxGeneratedImageBytes {
			return GeneratedImage{}, fmt.Errorf("generated image storage is unavailable")
		}
		return GeneratedImage{ID: id, Name: "Generated image", MIME: "image/png", Size: int(info.Size())}, nil
	} else if !os.IsNotExist(err) {
		return GeneratedImage{}, err
	}
	encoded, err := staticGeneratedPNG(data)
	if err != nil {
		return GeneratedImage{}, err
	}
	entries, err := os.ReadDir(folder)
	if err != nil {
		return GeneratedImage{}, err
	}
	var used int64
	for _, entry := range entries {
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			return GeneratedImage{}, fmt.Errorf("generated image storage is unavailable")
		}
		used += info.Size()
	}
	if used+int64(len(encoded)) > maxGeneratedSessionBytes {
		return GeneratedImage{}, fmt.Errorf("generated image storage limit reached")
	}
	temporary, err := os.CreateTemp(folder, ".generated-*.tmp")
	if err != nil {
		return GeneratedImage{}, err
	}
	defer os.Remove(temporary.Name())
	if err = temporary.Chmod(0600); err == nil {
		_, err = temporary.Write(encoded)
	}
	if err == nil {
		err = temporary.Sync()
	}
	closeErr := temporary.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return GeneratedImage{}, err
	}
	if err = os.Link(temporary.Name(), target); err != nil {
		return GeneratedImage{}, fmt.Errorf("generated image could not be published: %w", err)
	}
	return GeneratedImage{ID: id, Name: "Generated image", MIME: "image/png", Size: len(encoded)}, nil
}

func (d *Daemon) handleGeneratedImageMedia(w http.ResponseWriter, r *http.Request) {
	sessionID, imageID := r.PathValue("id"), r.PathValue("imageID")
	if _, err := d.store.GetSession(sessionID); err != nil {
		writeStoreError(w, err)
		return
	}
	if !generatedIDPattern.MatchString(imageID) {
		writeError(w, 404, fmt.Errorf("generated image not found"))
		return
	}
	root, err := os.OpenRoot(d.sessions.generatedImageFolder(sessionID))
	if err != nil {
		writeError(w, 404, fmt.Errorf("generated image not found"))
		return
	}
	defer root.Close()
	name := imageID + ".png"
	link, err := root.Lstat(name)
	if err != nil || !link.Mode().IsRegular() || link.Size() <= 0 || link.Size() > maxGeneratedImageBytes {
		writeError(w, 404, fmt.Errorf("generated image not found"))
		return
	}
	file, err := root.Open(name)
	if err != nil {
		writeError(w, 404, fmt.Errorf("generated image not found"))
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || !os.SameFile(link, info) || info.Size() != link.Size() {
		writeError(w, 404, fmt.Errorf("generated image not found"))
		return
	}
	header := make([]byte, 8)
	if _, err = io.ReadFull(file, header); err != nil || !bytes.Equal(header, []byte("\x89PNG\r\n\x1a\n")) {
		writeError(w, 404, fmt.Errorf("generated image not found"))
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, name, info.ModTime(), io.NewSectionReader(file, 0, info.Size()))
}
