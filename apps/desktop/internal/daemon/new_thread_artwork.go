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
	"sync"
	"unicode"

	"github.com/google/uuid"
)

const artworkDirectory = "new-thread-backgrounds"
const artworkStateFile = "new-thread-artwork.json"
const maxArtworkBytes = 24 * 1024 * 1024

type NewThreadArtworkEffect string

const (
	ArtworkEffectNone      NewThreadArtworkEffect = "none"
	ArtworkEffectDither    NewThreadArtworkEffect = "dither"
	ArtworkEffectASCII     NewThreadArtworkEffect = "ascii"
	ArtworkEffectHalftone  NewThreadArtworkEffect = "halftone"
	ArtworkEffectScanlines NewThreadArtworkEffect = "scanlines"
)

func validArtworkEffect(effect NewThreadArtworkEffect) bool {
	switch effect {
	case ArtworkEffectNone, ArtworkEffectDither, ArtworkEffectASCII, ArtworkEffectHalftone, ArtworkEffectScanlines:
		return true
	default:
		return false
	}
}

type NewThreadArtworkImage struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	File string `json:"-"`
	MIME string `json:"mime"`
}

type NewThreadArtworkState struct {
	Image  *NewThreadArtworkImage `json:"image,omitempty"`
	Effect NewThreadArtworkEffect `json:"effect"`
}

type persistedArtworkImage struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	File string `json:"file"`
	MIME string `json:"mime"`
}
type persistedArtworkState struct {
	Image  *persistedArtworkImage `json:"image,omitempty"`
	Effect NewThreadArtworkEffect `json:"effect"`
}

type artworkStore struct {
	mu      sync.RWMutex
	dataDir string
	state   NewThreadArtworkState
}

func newArtworkStore(dataDir string) (*artworkStore, error) {
	store := &artworkStore{dataDir: dataDir, state: NewThreadArtworkState{Effect: ArtworkEffectNone}}
	data, err := os.ReadFile(filepath.Join(dataDir, artworkStateFile))
	if os.IsNotExist(err) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read new-thread artwork settings: %w", err)
	}
	var persisted persistedArtworkState
	if err := json.Unmarshal(data, &persisted); err != nil || !validArtworkEffect(persisted.Effect) || (persisted.Image != nil && !store.managed(persisted.Image.File)) {
		return store, nil
	}
	state := NewThreadArtworkState{Effect: persisted.Effect}
	if persisted.Image != nil {
		if _, err := os.Stat(filepath.Join(store.folder(), persisted.Image.File)); err == nil {
			state.Image = &NewThreadArtworkImage{ID: persisted.Image.ID, Name: persisted.Image.Name, File: persisted.Image.File, MIME: persisted.Image.MIME}
		}
	}
	store.state = state
	return store, nil
}

func (s *artworkStore) folder() string { return filepath.Join(s.dataDir, artworkDirectory) }
func (s *artworkStore) managed(file string) bool {
	return file != "" && filepath.Base(file) == file && strings.HasPrefix(file, "new-thread-background-")
}
func (s *artworkStore) snapshotLocked() NewThreadArtworkState {
	state := s.state
	if state.Image != nil {
		image := *state.Image
		state.Image = &image
	}
	return state
}
func (s *artworkStore) snapshot() NewThreadArtworkState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshotLocked()
}
func (s *artworkStore) saveLocked(state NewThreadArtworkState) error {
	persisted := persistedArtworkState{Effect: state.Effect}
	if state.Image != nil {
		persisted.Image = &persistedArtworkImage{ID: state.Image.ID, Name: state.Image.Name, File: state.Image.File, MIME: state.Image.MIME}
	}
	data, err := json.Marshal(persisted)
	if err != nil {
		return err
	}
	temporary := filepath.Join(s.dataDir, "."+artworkStateFile+".tmp")
	if err = os.WriteFile(temporary, data, 0600); err != nil {
		return err
	}
	return os.Rename(temporary, filepath.Join(s.dataDir, artworkStateFile))
}
func safeArtworkName(name, fallback string) string {
	name = filepath.Base(name)
	name = strings.Map(func(value rune) rune {
		if unicode.IsControl(value) {
			return -1
		}
		return value
	}, name)
	if name == "" || name == "." || len(name) > 256 {
		return fallback
	}
	return name
}
func (s *artworkStore) install(name string, data []byte) (NewThreadArtworkState, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 64_000_000 {
		return NewThreadArtworkState{}, fmt.Errorf("choose a valid PNG, JPEG or GIF image up to 64 megapixels")
	}
	if _, _, err = image.Decode(bytes.NewReader(data)); err != nil {
		return NewThreadArtworkState{}, fmt.Errorf("choose a valid PNG, JPEG or GIF image up to 64 megapixels")
	}
	ext := map[string]string{"png": ".png", "jpeg": ".jpg", "gif": ".gif"}[format]
	if ext == "" {
		return NewThreadArtworkState{}, fmt.Errorf("unsupported image format")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.folder(), 0700); err != nil {
		return NewThreadArtworkState{}, fmt.Errorf("save artwork: %w", err)
	}
	file := "new-thread-background-" + uuid.NewString() + ext
	temporary := filepath.Join(s.folder(), "."+file+".tmp")
	if err := os.WriteFile(temporary, data, 0600); err != nil {
		return NewThreadArtworkState{}, fmt.Errorf("save artwork: %w", err)
	}
	if err := os.Rename(temporary, filepath.Join(s.folder(), file)); err != nil {
		_ = os.Remove(temporary)
		return NewThreadArtworkState{}, fmt.Errorf("save artwork: %w", err)
	}
	next := s.state
	previous := next.Image
	next.Image = &NewThreadArtworkImage{ID: uuid.NewString(), Name: safeArtworkName(name, "Artwork"+ext), File: file, MIME: "image/" + format}
	if err := s.saveLocked(next); err != nil {
		_ = os.Remove(filepath.Join(s.folder(), file))
		return NewThreadArtworkState{}, fmt.Errorf("save artwork settings: %w", err)
	}
	s.state = next
	if previous != nil && s.managed(previous.File) {
		_ = os.Remove(filepath.Join(s.folder(), previous.File))
	}
	return s.snapshotLocked(), nil
}
func (s *artworkStore) remove() (NewThreadArtworkState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Image == nil {
		return s.state, nil
	}
	next := s.state
	previous := next.Image
	next.Image = nil
	if err := s.saveLocked(next); err != nil {
		return NewThreadArtworkState{}, fmt.Errorf("save artwork settings: %w", err)
	}
	s.state = next
	if s.managed(previous.File) {
		_ = os.Remove(filepath.Join(s.folder(), previous.File))
	}
	return s.snapshotLocked(), nil
}
func (s *artworkStore) setEffect(effect NewThreadArtworkEffect) (NewThreadArtworkState, error) {
	if !validArtworkEffect(effect) {
		return NewThreadArtworkState{}, fmt.Errorf("unknown background effect")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.state
	next.Effect = effect
	if err := s.saveLocked(next); err != nil {
		return NewThreadArtworkState{}, fmt.Errorf("save artwork settings: %w", err)
	}
	s.state = next
	return s.snapshotLocked(), nil
}
func (s *artworkStore) media() (*NewThreadArtworkImage, *os.File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state.Image == nil || !s.managed(s.state.Image.File) {
		return nil, nil, os.ErrNotExist
	}
	root, err := os.OpenRoot(s.folder())
	if err != nil {
		return nil, nil, err
	}
	defer root.Close()
	info, err := root.Lstat(s.state.Image.File)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, nil, os.ErrNotExist
	}
	file, err := root.Open(s.state.Image.File)
	if err != nil {
		return nil, nil, err
	}
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, nil, os.ErrNotExist
	}
	image := *s.state.Image
	return &image, file, nil
}

func (d *Daemon) recordArtworkChange() {
	_, _ = d.store.db.Exec(`INSERT INTO activity(kind,entity_id,session_id,data) VALUES('artwork','new-thread','','{}')`)
}
func (d *Daemon) handleNewThreadArtwork(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, d.artwork.snapshot())
}
func (d *Daemon) handleUploadNewThreadArtwork(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxArtworkBytes))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Errorf("image exceeds 24 MiB"))
		return
	}
	state, err := d.artwork.install(r.URL.Query().Get("name"), data)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	d.recordArtworkChange()
	writeJSON(w, http.StatusCreated, state)
}
func (d *Daemon) handleArtworkEffect(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Effect NewThreadArtworkEffect `json:"effect"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("valid background effect required"))
		return
	}
	state, err := d.artwork.setEffect(body.Effect)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	d.recordArtworkChange()
	writeJSON(w, http.StatusOK, state)
}
func (d *Daemon) handleRemoveNewThreadArtwork(w http.ResponseWriter, r *http.Request) {
	state, err := d.artwork.remove()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	d.recordArtworkChange()
	writeJSON(w, http.StatusOK, state)
}
func (d *Daemon) handleNewThreadArtworkMedia(w http.ResponseWriter, r *http.Request) {
	artwork, file, err := d.artwork.media()
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("artwork not found"))
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("artwork not found"))
		return
	}
	w.Header().Set("Content-Type", artwork.MIME)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, artwork.Name, info.ModTime(), file)
}
