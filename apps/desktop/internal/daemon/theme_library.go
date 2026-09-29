package daemon

// The theme library deliberately lives in the daemon. Browser imports remain
// snapshots, but linked paths must be compiled and persisted by the process
// that has the native file-picker grant. This file never evaluates CSS or
// imports network resources: it reads a bounded JSON/JSON5 subset and returns
// normalized VS Code documents for the renderer to map to its fixed palette.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	json5 "github.com/titanous/json5"
)

const (
	themeSourceBytes  = int64(2 * 1024 * 1024)
	themeLibraryBytes = int64(8 * 1024 * 1024)
	themeIncludeDepth = 32
	themeEntryLimit   = 64
	themeVariantLimit = 256
)

type ThemeDocument map[string]any

type ThemeVariantSource struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	Appearance string        `json:"appearance"`
	SourcePath string        `json:"sourcePath,omitempty"`
	Document   ThemeDocument `json:"document"`
}

type ThemeLibraryStatus struct {
	State   string `json:"state"`
	Message string `json:"message,omitempty"`
}

// ThemeVariantFailure is retained alongside compiled siblings. It lets the UI
// explain exactly which extension declaration needs repair without dropping
// valid, already-selected variants.
type ThemeVariantFailure struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Path    string `json:"path"`
	Message string `json:"message"`
}

type ThemeLibrarySource struct {
	Kind string `json:"kind"`
	Path string `json:"path,omitempty"`
}

type ThemeLibraryEntry struct {
	ID                 string                `json:"id"`
	Name               string                `json:"name"`
	Source             ThemeLibrarySource    `json:"source"`
	SelectedVariantIDs []string              `json:"selectedVariantIds"`
	Variants           []ThemeVariantSource  `json:"variants"`
	Failures           []ThemeVariantFailure `json:"failures,omitempty"`
	Status             ThemeLibraryStatus    `json:"status"`
}

// A review uses the same bounded compiler as installation. The digest makes
// selection refer to exactly the analyzed source, even if the files change
// while the dialog is open.
type ThemeImportPreview struct {
	Path       string                `json:"path"`
	Name       string                `json:"name"`
	SourceKind string                `json:"sourceKind"`
	Variants   []ThemeVariantSource  `json:"variants"`
	Failures   []ThemeVariantFailure `json:"failures"`
	Digest     string                `json:"digest"`
}

const themePreviewID = "custom-preview"

func themeSourceName(path string) string {
	name := filepath.Base(filepath.Clean(path))
	if name == "package.json" {
		name = filepath.Base(filepath.Dir(filepath.Clean(path)))
	}
	return strings.TrimSuffix(name, filepath.Ext(name))
}

func compileThemePreview(path string) (ThemeImportPreview, error) {
	if !filepath.IsAbs(path) {
		return ThemeImportPreview{}, fmt.Errorf("choose an absolute theme file or extension folder")
	}
	resolved, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return ThemeImportPreview{}, fmt.Errorf("resolve theme source: %w", err)
	}
	compiled, source, err := compileThemeSource(resolved, themePreviewID, themeSourceName(resolved))
	if err != nil {
		return ThemeImportPreview{}, err
	}
	preview := ThemeImportPreview{Path: source.Path, Name: compiled.name, SourceKind: source.Kind, Variants: compiled.variants, Failures: compiled.failures}
	data, err := json.Marshal(struct {
		Path     string
		Name     string
		Kind     string
		Variants []ThemeVariantSource
		Failures []ThemeVariantFailure
	}{preview.Path, preview.Name, preview.SourceKind, preview.Variants, preview.Failures})
	if err != nil {
		return ThemeImportPreview{}, err
	}
	sum := sha256.Sum256(data)
	preview.Digest = hex.EncodeToString(sum[:])
	return preview, nil
}

func (l *ThemeLibrary) importReviewed(path, digest, mode string, selected []string) (ThemeLibraryEntry, error) {
	if mode != "snapshot" && mode != "link" {
		return ThemeLibraryEntry{}, fmt.Errorf("choose Import a copy or Link to source")
	}
	if len(digest) != 64 || len(selected) == 0 || len(selected) > themeVariantLimit {
		return ThemeLibraryEntry{}, fmt.Errorf("analyze the source and select at least one variant")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	next := cloneThemeEntries(l.entries)
	if len(next) >= themeEntryLimit {
		return ThemeLibraryEntry{}, fmt.Errorf("custom theme library is limited to %d entries", themeEntryLimit)
	}
	preview, err := compileThemePreview(path)
	if err != nil {
		return ThemeLibraryEntry{}, err
	}
	if preview.Digest != digest {
		return ThemeLibraryEntry{}, fmt.Errorf("the theme source changed after analysis; analyze it again")
	}
	wanted := make(map[string]bool, len(selected))
	for _, id := range selected {
		if wanted[id] {
			return ThemeLibraryEntry{}, fmt.Errorf("duplicate selected variant")
		}
		wanted[id] = true
	}
	id := uniqueThemeID(slugTheme(preview.Name), next)
	variants := make([]ThemeVariantSource, 0, len(wanted))
	for _, variant := range preview.Variants {
		if !wanted[variant.ID] {
			continue
		}
		if !strings.HasPrefix(variant.ID, themePreviewID) {
			return ThemeLibraryEntry{}, fmt.Errorf("invalid compiled variant identity")
		}
		originalID := variant.ID
		variant.ID = id + strings.TrimPrefix(variant.ID, themePreviewID)
		variants = append(variants, variant)
		delete(wanted, originalID)
	}
	if len(wanted) != 0 || len(variants) == 0 {
		return ThemeLibraryEntry{}, fmt.Errorf("selected theme variants changed; analyze again")
	}
	source := ThemeLibrarySource{Kind: preview.SourceKind, Path: preview.Path}
	if mode == "snapshot" {
		source.Kind = "snapshot"
	}
	entry := ThemeLibraryEntry{ID: id, Name: preview.Name, Source: source, SelectedVariantIDs: variantIDs(variants), Variants: variants, Status: ThemeLibraryStatus{State: "ready"}}
	next = append(next, entry)
	if err := l.saveLocked(next); err != nil {
		return ThemeLibraryEntry{}, err
	}
	return entry, nil
}

type themeLibraryDisk struct {
	Version int                 `json:"version"`
	Entries []ThemeLibraryEntry `json:"entries"`
}

type ThemeLibrary struct {
	mu      sync.RWMutex
	dataDir string
	entries []ThemeLibraryEntry
}

func NewThemeLibrary(dataDir string) (*ThemeLibrary, error) {
	library := &ThemeLibrary{dataDir: dataDir}
	if err := library.load(); err != nil {
		return nil, err
	}
	return library, nil
}

func (l *ThemeLibrary) path() string {
	return filepath.Join(l.dataDir, "custom-themes", "library.json")
}
func (l *ThemeLibrary) backupPath() string { return l.path() + ".bak" }

func (l *ThemeLibrary) load() error {
	path := l.path()
	contents, err := boundedFile(path, themeLibraryBytes)
	if os.IsNotExist(err) {
		contents, err = boundedFile(l.backupPath(), themeLibraryBytes)
		if os.IsNotExist(err) {
			return nil
		}
	}
	if err != nil {
		contents, err = boundedFile(l.backupPath(), themeLibraryBytes)
		if err != nil {
			return fmt.Errorf("read custom theme library: %w", err)
		}
	}
	var disk themeLibraryDisk
	if err := json.Unmarshal(contents, &disk); err != nil {
		return fmt.Errorf("parse custom theme library: %w", err)
	}
	if disk.Version != 1 {
		return fmt.Errorf("unsupported custom theme library version")
	}
	if err := validateThemeEntries(disk.Entries); err != nil {
		return err
	}
	l.entries = disk.Entries
	return nil
}

func (l *ThemeLibrary) snapshot() []ThemeLibraryEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return cloneThemeEntries(l.entries)
}

func cloneThemeEntries(entries []ThemeLibraryEntry) []ThemeLibraryEntry {
	data, _ := json.Marshal(entries)
	var cloned []ThemeLibraryEntry
	_ = json.Unmarshal(data, &cloned)
	return cloned
}

func (l *ThemeLibrary) saveLocked(next []ThemeLibraryEntry) error {
	if err := validateThemeEntries(next); err != nil {
		return err
	}
	disk, err := json.Marshal(themeLibraryDisk{Version: 1, Entries: next})
	if err != nil {
		return err
	}
	if int64(len(disk)) > themeLibraryBytes {
		return fmt.Errorf("custom theme library exceeds 8 MB")
	}
	path := l.path()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".theme-library-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err = temporary.Chmod(0600); err == nil {
		_, err = temporary.Write(disk)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(path); statErr == nil {
		_ = os.Remove(l.backupPath())
		if err = os.Rename(path, l.backupPath()); err != nil {
			return err
		}
	}
	if err = os.Rename(temporaryName, path); err != nil {
		_ = os.Rename(l.backupPath(), path)
		return err
	}
	_ = os.Remove(l.backupPath())
	l.entries = next
	return nil
}

func (l *ThemeLibrary) mutate(fn func([]ThemeLibraryEntry) ([]ThemeLibraryEntry, error)) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	next, err := fn(cloneThemeEntries(l.entries))
	if err != nil {
		return err
	}
	return l.saveLocked(next)
}

func (l *ThemeLibrary) link(path, name string) (ThemeLibraryEntry, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	next := cloneThemeEntries(l.entries)
	if len(next) >= themeEntryLimit {
		return ThemeLibraryEntry{}, fmt.Errorf("custom theme library is limited to %d entries", themeEntryLimit)
	}
	id := uniqueThemeID(slugTheme(name), next)
	compiled, source, err := compileThemeSource(path, id, name)
	if err != nil {
		return ThemeLibraryEntry{}, err
	}
	entry := ThemeLibraryEntry{ID: id, Name: compiled.name, Source: source, SelectedVariantIDs: variantIDs(compiled.variants), Variants: compiled.variants, Failures: compiled.failures, Status: statusForThemeFailures(compiled.failures)}
	next = append(next, entry)
	if err := l.saveLocked(next); err != nil {
		return ThemeLibraryEntry{}, err
	}
	return entry, nil
}

func (l *ThemeLibrary) reload(id string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	next := cloneThemeEntries(l.entries)
	index := themeEntryIndex(next, id)
	if index < 0 {
		return fmt.Errorf("unknown custom theme %q", id)
	}
	entry := &next[index]
	if entry.Source.Kind == "snapshot" {
		return fmt.Errorf("snapshot themes cannot reload")
	}
	if entry.Source.Kind == "editableFile" {
		variants, name, err := loadEditableTheme(entry.Source.Path, entry.ID)
		if err != nil {
			entry.Status = ThemeLibraryStatus{State: "warning", Message: err.Error()}
			_ = l.saveLocked(next)
			return err
		}
		entry.Name, entry.Variants, entry.SelectedVariantIDs, entry.Status, entry.Failures = name, variants, variantIDs(variants), ThemeLibraryStatus{State: "ready"}, nil
		return l.saveLocked(next)
	}
	compiled, _, err := compileThemeSource(entry.Source.Path, entry.ID, entry.Name)
	if err != nil {
		entry.Status = ThemeLibraryStatus{State: "warning", Message: err.Error()}
		_ = l.saveLocked(next)
		return err
	}
	wanted := make(map[string]bool, len(entry.SelectedVariantIDs))
	for _, variantID := range entry.SelectedVariantIDs {
		wanted[variantID] = true
	}
	selectedFailures := make([]ThemeVariantFailure, 0)
	for _, failure := range compiled.failures {
		if wanted[failure.ID] {
			selectedFailures = append(selectedFailures, failure)
		}
	}
	if len(selectedFailures) > 0 {
		entry.Failures = selectedFailures
		entry.Status = statusForThemeFailures(selectedFailures)
		_ = l.saveLocked(next)
		return fmt.Errorf("%s", entry.Status.Message)
	}
	variants := make([]ThemeVariantSource, 0, len(compiled.variants))
	for _, variant := range compiled.variants {
		if wanted[variant.ID] {
			for _, previous := range entry.Variants {
				if previous.ID == variant.ID && previous.SourcePath != "" && previous.SourcePath != variant.SourcePath {
					err := fmt.Errorf("selected theme variant %q now resolves to a different source declaration", variant.Name)
					entry.Status = ThemeLibraryStatus{State: "warning", Message: err.Error()}
					_ = l.saveLocked(next)
					return err
				}
			}
			variants = append(variants, variant)
		}
	}
	if len(variants) != len(wanted) {
		err := fmt.Errorf("the linked source no longer contains selected theme variants")
		entry.Status = ThemeLibraryStatus{State: "warning", Message: err.Error()}
		_ = l.saveLocked(next)
		return err
	}
	entry.Name, entry.Variants, entry.Failures, entry.Status = compiled.name, variants, compiled.failures, statusForThemeFailures(compiled.failures)
	return l.saveLocked(next)
}

func (l *ThemeLibrary) unlink(id string) error {
	return l.mutate(func(next []ThemeLibraryEntry) ([]ThemeLibraryEntry, error) {
		i := themeEntryIndex(next, id)
		if i < 0 {
			return nil, fmt.Errorf("unknown custom theme %q", id)
		}
		next[i].Source = ThemeLibrarySource{Kind: "snapshot", Path: next[i].Source.Path}
		next[i].Status = ThemeLibraryStatus{State: "ready"}
		return next, nil
	})
}
func (l *ThemeLibrary) remove(id string) error {
	return l.mutate(func(next []ThemeLibraryEntry) ([]ThemeLibraryEntry, error) {
		i := themeEntryIndex(next, id)
		if i < 0 {
			return nil, fmt.Errorf("unknown custom theme %q", id)
		}
		return append(next[:i], next[i+1:]...), nil
	})
}

func (l *ThemeLibrary) duplicate(id, mode string) (ThemeLibraryEntry, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	next := cloneThemeEntries(l.entries)
	index := themeEntryIndex(next, id)
	if index < 0 {
		return ThemeLibraryEntry{}, fmt.Errorf("unknown custom theme %q", id)
	}
	original := next[index]
	if len(next) >= themeEntryLimit {
		return ThemeLibraryEntry{}, fmt.Errorf("custom theme library is limited to %d entries", themeEntryLimit)
	}
	copy := original
	copy.ID = uniqueThemeID(original.ID+"-copy", next)
	copy.Name = original.Name + " Copy"
	// A struct assignment leaves the variants slice shared with its source.
	// Rekeying a duplicate must never mutate the still-linked family.
	copy.Variants = append([]ThemeVariantSource(nil), original.Variants...)
	copy.Variants = rekeyVariants(copy.Variants, copy.ID)
	copy.SelectedVariantIDs = variantIDs(copy.Variants)
	copy.Status = ThemeLibraryStatus{State: "ready"}
	switch mode {
	case "snapshot":
		copy.Source = ThemeLibrarySource{Kind: "snapshot", Path: original.Source.Path}
	case "editable":
		copy.Source = ThemeLibrarySource{Kind: "editableFile", Path: filepath.Join(l.dataDir, "custom-themes", copy.ID+".zeron-theme.json")}
		if err := writeEditableTheme(copy.Source.Path, copy.ID, copy.Name, copy.Variants); err != nil {
			return ThemeLibraryEntry{}, err
		}
	default:
		return ThemeLibraryEntry{}, fmt.Errorf("unknown duplicate mode")
	}
	next = append(next, copy)
	if err := l.saveLocked(next); err != nil {
		return ThemeLibraryEntry{}, err
	}
	return copy, nil
}

func themeEntryIndex(entries []ThemeLibraryEntry, id string) int {
	for i := range entries {
		if entries[i].ID == id {
			return i
		}
	}
	return -1
}
func variantIDs(variants []ThemeVariantSource) []string {
	ids := make([]string, len(variants))
	for i := range variants {
		ids[i] = variants[i].ID
	}
	return ids
}
func uniqueThemeID(base string, entries []ThemeLibraryEntry) string {
	base = "custom-" + strings.TrimPrefix(slugTheme(base), "custom-")
	used := map[string]bool{}
	for _, e := range entries {
		used[e.ID] = true
	}
	for n := 1; ; n++ {
		id := base
		if n > 1 {
			id = fmt.Sprintf("%s-%d", base, n)
		}
		if !used[id] {
			return id
		}
	}
}
func slugTheme(value string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(value) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			if dash && b.Len() > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r)
			dash = false
		} else {
			dash = true
		}
	}
	if b.Len() == 0 {
		return "theme"
	}
	return b.String()
}

type compiledThemeSource struct {
	name     string
	variants []ThemeVariantSource
	failures []ThemeVariantFailure
}

func statusForThemeFailures(failures []ThemeVariantFailure) ThemeLibraryStatus {
	if len(failures) == 0 {
		return ThemeLibraryStatus{State: "ready"}
	}
	parts := make([]string, 0, len(failures))
	for _, failure := range failures {
		parts = append(parts, fmt.Sprintf("%s: %s", failure.Name, failure.Message))
	}
	return ThemeLibraryStatus{State: "warning", Message: strings.Join(parts, "; ")}
}

func compileThemeSource(selected, familyID, familyName string) (compiledThemeSource, ThemeLibrarySource, error) {
	if selected == "" || !filepath.IsAbs(selected) {
		return compiledThemeSource{}, ThemeLibrarySource{}, fmt.Errorf("choose an absolute theme file or extension folder")
	}
	path, err := filepath.EvalSymlinks(filepath.Clean(selected))
	if err != nil {
		return compiledThemeSource{}, ThemeLibrarySource{}, fmt.Errorf("resolve theme source: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return compiledThemeSource{}, ThemeLibrarySource{}, err
	}
	if info.IsDir() || filepath.Base(path) == "package.json" {
		manifest := path
		if info.IsDir() {
			manifest = filepath.Join(path, "package.json")
		}
		root, err := filepath.EvalSymlinks(filepath.Dir(manifest))
		if err != nil {
			return compiledThemeSource{}, ThemeLibrarySource{}, err
		}
		manifest, err = containedPath(manifest, root, "theme package")
		if err != nil {
			return compiledThemeSource{}, ThemeLibrarySource{}, err
		}
		value, err := readJSON5(manifest, "theme package")
		if err != nil {
			return compiledThemeSource{}, ThemeLibrarySource{}, err
		}
		declarations, ok := nested(value, "contributes", "themes").([]any)
		if !ok || len(declarations) == 0 {
			return compiledThemeSource{}, ThemeLibrarySource{}, fmt.Errorf("package.json must declare contributes.themes")
		}
		if len(declarations) > themeVariantLimit {
			return compiledThemeSource{}, ThemeLibrarySource{}, fmt.Errorf("extension declares too many theme variants")
		}
		name := themeString(value["displayName"])
		if name == "" {
			name = themeString(value["name"])
		}
		if name == "" {
			name = familyName
		}
		labels := make([]string, len(declarations))
		baseIDs := make([]string, len(declarations))
		for index, raw := range declarations {
			label := fmt.Sprintf("Variant %d", index+1)
			if declaration, ok := raw.(map[string]any); ok && themeString(declaration["label"]) != "" {
				label = themeString(declaration["label"])
			}
			labels[index], baseIDs[index] = label, familyID+"-"+slugTheme(label)
		}
		variantIDs := allocateVariantIDs(baseIDs)
		variants := []ThemeVariantSource{}
		failures := []ThemeVariantFailure{}
		for index, raw := range declarations {
			declaration, ok := raw.(map[string]any)
			label, variantID := labels[index], variantIDs[index]
			if !ok {
				failures = append(failures, ThemeVariantFailure{ID: variantID, Name: label, Path: manifest, Message: "theme declaration must be an object"})
				continue
			}
			relative := themeString(declaration["path"])
			if relative == "" {
				failures = append(failures, ThemeVariantFailure{ID: variantID, Name: label, Path: manifest, Message: "theme declaration has no path"})
				continue
			}
			file, err := resolveThemePath(manifest, relative, root)
			if err != nil {
				failures = append(failures, ThemeVariantFailure{ID: variantID, Name: label, Path: filepath.Join(filepath.Dir(manifest), relative), Message: err.Error()})
				continue
			}
			document, err := loadThemeDocument(file, root, nil)
			if err != nil {
				failures = append(failures, ThemeVariantFailure{ID: variantID, Name: label, Path: file, Message: err.Error()})
				continue
			}
			variants = append(variants, ThemeVariantSource{ID: variantID, Name: label, Appearance: themeAppearance(document, themeString(declaration["uiTheme"])), SourcePath: file, Document: document})
		}
		if len(variants) == 0 {
			return compiledThemeSource{}, ThemeLibrarySource{}, fmt.Errorf("no valid declared VS Code theme variants")
		}
		return compiledThemeSource{name: name, variants: variants, failures: failures}, ThemeLibrarySource{Kind: "linkedPackage", Path: path}, nil
	}
	root, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return compiledThemeSource{}, ThemeLibrarySource{}, err
	}
	path, err = containedPath(path, root, "theme file")
	if err != nil {
		return compiledThemeSource{}, ThemeLibrarySource{}, err
	}
	document, err := loadThemeDocument(path, root, nil)
	if err != nil {
		return compiledThemeSource{}, ThemeLibrarySource{}, err
	}
	name := themeString(document["name"])
	if name == "" {
		name = familyName
	}
	return compiledThemeSource{name: name, variants: []ThemeVariantSource{{ID: familyID, Name: name, Appearance: themeAppearance(document, ""), SourcePath: path, Document: document}}}, ThemeLibrarySource{Kind: "linkedFile", Path: path}, nil
}

func readJSON5(path, kind string) (map[string]any, error) {
	data, err := boundedFile(path, themeSourceBytes)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", kind, err)
	}
	var value map[string]any
	if err := json5.Unmarshal(data, &value); err != nil {
		return nil, fmt.Errorf("parse %s: %w", kind, err)
	}
	if value == nil {
		return nil, fmt.Errorf("%s must be a JSON object", kind)
	}
	return value, nil
}
func boundedFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%s is not a regular theme file", filepath.Base(path))
	}
	if info.Size() > limit {
		return nil, fmt.Errorf("%s exceeds the %d-byte limit", filepath.Base(path), limit)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() {
		return nil, fmt.Errorf("%s is not a regular theme file", filepath.Base(path))
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s exceeds the %d-byte limit", filepath.Base(path), limit)
	}
	return data, nil
}
func containedPath(path, root, kind string) (string, error) {
	cleaned, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(root, cleaned)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%s resolves outside the selected source root", kind)
	}
	return cleaned, nil
}
func resolveThemePath(owner, relative, root string) (string, error) {
	if relative == "" || filepath.IsAbs(relative) || strings.Contains(relative, "://") {
		return "", fmt.Errorf("theme imports must be local relative paths")
	}
	return containedPath(filepath.Join(filepath.Dir(owner), relative), root, "theme include")
}

func loadThemeDocument(path, root string, stack []string) (ThemeDocument, error) {
	if len(stack) >= themeIncludeDepth {
		return nil, fmt.Errorf("theme include depth exceeds %d", themeIncludeDepth)
	}
	for _, seen := range stack {
		if seen == path {
			return nil, fmt.Errorf("theme include cycle")
		}
	}
	value, err := readJSON5(path, "theme source")
	if err != nil {
		return nil, err
	}
	document := ThemeDocument{}
	if include := themeString(value["include"]); include != "" {
		includePath, err := resolveThemePath(path, include, root)
		if err != nil {
			return nil, err
		}
		document, err = loadThemeDocument(includePath, root, append(stack, path))
		if err != nil {
			return nil, err
		}
	}
	for key, value := range value {
		switch key {
		case "include":
		case "colors":
			colors, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("VS Code colors must be an object")
			}
			existing, _ := document["colors"].(map[string]any)
			if existing == nil {
				existing = map[string]any{}
			}
			for colorKey, color := range colors {
				if !validThemeColor(themeString(color)) {
					return nil, fmt.Errorf("unsupported color for %q", colorKey)
				}
				existing[colorKey] = color
			}
			document["colors"] = existing
		case "tokenColors":
			tokens, err := loadTokenColors(path, value, root)
			if err != nil {
				return nil, err
			}
			existing, _ := document["tokenColors"].([]any)
			document["tokenColors"] = append(existing, tokens...)
		case "semanticTokenColors":
			semantic, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("semanticTokenColors must be an object")
			}
			existing, _ := document["semanticTokenColors"].(map[string]any)
			if existing == nil {
				existing = map[string]any{}
			}
			for selector, style := range semantic {
				if err := validateStyleColor(style); err != nil {
					return nil, fmt.Errorf("semantic token %q: %w", selector, err)
				}
				existing[selector] = style
			}
			document["semanticTokenColors"] = existing
		default:
			document[key] = value
		}
	}
	if _, colors := document["colors"]; !colors {
		if _, tokens := document["tokenColors"]; !tokens {
			if _, semantic := document["semanticTokenColors"]; !semantic {
				return nil, fmt.Errorf("theme contains no colors or token rules")
			}
		}
	}
	return document, nil
}
func loadTokenColors(owner string, value any, root string) ([]any, error) {
	if relative, ok := value.(string); ok {
		path, err := resolveThemePath(owner, relative, root)
		if err != nil {
			return nil, err
		}
		data, err := boundedFile(path, themeSourceBytes)
		if err != nil {
			return nil, err
		}
		var raw any
		if err = json5.Unmarshal(data, &raw); err != nil {
			return nil, fmt.Errorf("parse token file: %w", err)
		}
		if object, ok := raw.(map[string]any); ok {
			raw = object["tokenColors"]
		}
		value = raw
	}
	tokens, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("tokenColors must be an array or local file")
	}
	for _, token := range tokens {
		if err := validateTokenColor(token); err != nil {
			return nil, err
		}
	}
	return tokens, nil
}
func validateTokenColor(raw any) error {
	object, ok := raw.(map[string]any)
	if !ok {
		return fmt.Errorf("token rule must be an object")
	}
	settings, ok := object["settings"].(map[string]any)
	if !ok {
		return nil
	}
	if color, exists := settings["foreground"]; exists && !validThemeColor(themeString(color)) {
		return fmt.Errorf("token foreground must be #RRGGBB or #RRGGBBAA")
	}
	return nil
}
func validateStyleColor(raw any) error {
	if color, ok := raw.(string); ok {
		if !validThemeColor(color) {
			return fmt.Errorf("color must be #RRGGBB or #RRGGBBAA")
		}
		return nil
	}
	if object, ok := raw.(map[string]any); ok {
		if color, exists := object["foreground"]; exists && !validThemeColor(themeString(color)) {
			return fmt.Errorf("foreground must be #RRGGBB or #RRGGBBAA")
		}
		return nil
	}
	return fmt.Errorf("style must be a color or object")
}
func validThemeColor(value string) bool {
	if len(value) != 7 && len(value) != 9 {
		return false
	}
	if value[0] != '#' {
		return false
	}
	for _, r := range value[1:] {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}
func themeString(value any) string { output, _ := value.(string); return strings.TrimSpace(output) }
func nested(value map[string]any, keys ...string) any {
	var current any = value
	for _, key := range keys {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}
func themeAppearance(document ThemeDocument, declared string) string {
	declared = strings.ToLower(declared)
	if declared == "vs" || strings.Contains(declared, "light") {
		return "light"
	}
	if strings.Contains(declared, "dark") {
		return "dark"
	}
	if strings.EqualFold(themeString(document["type"]), "light") {
		return "light"
	}
	return "dark"
}
func dedupeVariants(variants []ThemeVariantSource) []ThemeVariantSource {
	// Reserve every source-declared ID before assigning a suffix. For
	// [Dark, Dark, Dark 2], this keeps Dark 2's canonical ID and gives the
	// second Dark the next unclaimed value (Dark 3), rather than colliding
	// with the later declaration.
	bases := make([]string, len(variants))
	for i := range variants {
		bases[i] = variants[i].ID
	}
	ids := allocateVariantIDs(bases)
	for i := range variants {
		variants[i].ID = ids[i]
	}
	return variants
}
func allocateVariantIDs(bases []string) []string {
	reserved := make(map[string]bool, len(bases))
	for _, base := range bases {
		reserved[base] = true
	}
	emitted := make(map[string]bool, len(bases))
	ids := make([]string, len(bases))
	for index, base := range bases {
		candidate := base
		if emitted[candidate] {
			for suffix := 2; ; suffix++ {
				next := fmt.Sprintf("%s-%d", base, suffix)
				if !reserved[next] && !emitted[next] {
					candidate = next
					break
				}
			}
		}
		ids[index] = candidate
		emitted[candidate] = true
	}
	return ids
}
func rekeyVariants(variants []ThemeVariantSource, familyID string) []ThemeVariantSource {
	for i := range variants {
		variants[i].ID = familyID + "-" + slugTheme(variants[i].Name)
	}
	return dedupeVariants(variants)
}

type editableThemeFile struct {
	ID       string               `json:"id"`
	Name     string               `json:"name"`
	Variants []ThemeVariantSource `json:"variants"`
}

func writeEditableTheme(path, id, name string, variants []ThemeVariantSource) error {
	data, err := json.MarshalIndent(editableThemeFile{ID: id, Name: name, Variants: variants}, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".editable-theme-*.tmp")
	if err != nil {
		return err
	}
	temp := temporary.Name()
	defer os.Remove(temp)
	if err = temporary.Chmod(0600); err == nil {
		_, err = temporary.Write(data)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(temp, path)
}
func loadEditableTheme(path, expectedID string) ([]ThemeVariantSource, string, error) {
	data, err := boundedFile(path, themeLibraryBytes)
	if err != nil {
		return nil, "", err
	}
	var family editableThemeFile
	if err = json.Unmarshal(data, &family); err != nil {
		return nil, "", err
	}
	if family.ID != expectedID {
		return nil, "", fmt.Errorf("editable family id must remain %q", expectedID)
	}
	if strings.TrimSpace(family.Name) == "" || len(family.Variants) == 0 {
		return nil, "", fmt.Errorf("editable family needs a name and at least one variant")
	}
	seen := make(map[string]bool, len(family.Variants))
	for _, variant := range family.Variants {
		if variant.ID == "" || variant.Name == "" || variant.Appearance != "light" && variant.Appearance != "dark" {
			return nil, "", fmt.Errorf("editable family has an invalid variant")
		}
		if seen[variant.ID] {
			return nil, "", fmt.Errorf("editable family contains duplicate variant id %q", variant.ID)
		}
		seen[variant.ID] = true
		if _, err := validateEditableDocument(variant.Document); err != nil {
			return nil, "", err
		}
	}
	return family.Variants, family.Name, nil
}
func validateEditableDocument(document ThemeDocument) (ThemeDocument, error) {
	data, err := json.Marshal(document)
	if err != nil {
		return nil, err
	}
	var decoded ThemeDocument
	if err = json.Unmarshal(data, &decoded); err != nil {
		return nil, err
	}
	hasStyle := false
	if colors, exists := decoded["colors"]; exists {
		values, ok := colors.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("editable colors must be an object")
		}
		for key, value := range values {
			if !validThemeColor(themeString(value)) {
				return nil, fmt.Errorf("unsupported color for %q", key)
			}
		}
		hasStyle = len(values) > 0
	}
	if tokens, exists := decoded["tokenColors"]; exists {
		values, ok := tokens.([]any)
		if !ok {
			return nil, fmt.Errorf("editable tokenColors must be an array")
		}
		for _, value := range values {
			if err := validateTokenColor(value); err != nil {
				return nil, err
			}
		}
		hasStyle = hasStyle || len(values) > 0
	}
	if semantic, exists := decoded["semanticTokenColors"]; exists {
		values, ok := semantic.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("editable semanticTokenColors must be an object")
		}
		for selector, value := range values {
			if err := validateStyleColor(value); err != nil {
				return nil, fmt.Errorf("semantic token %q: %w", selector, err)
			}
		}
		hasStyle = hasStyle || len(values) > 0
	}
	if !hasStyle {
		return nil, fmt.Errorf("editable variant needs colors or token rules")
	}
	return decoded, nil
}

func validateThemeEntries(entries []ThemeLibraryEntry) error {
	if len(entries) > themeEntryLimit {
		return fmt.Errorf("custom theme library is limited to %d entries", themeEntryLimit)
	}
	variants := 0
	seen := map[string]bool{}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.ID, "custom-") || seen[entry.ID] || strings.TrimSpace(entry.Name) == "" {
			return fmt.Errorf("invalid custom theme library entry")
		}
		seen[entry.ID] = true
		variants += len(entry.Variants)
		if variants > themeVariantLimit {
			return fmt.Errorf("custom theme library is limited to %d variants", themeVariantLimit)
		}
		entryVariantIDs := make(map[string]bool, len(entry.Variants))
		for _, variant := range entry.Variants {
			if !strings.HasPrefix(variant.ID, entry.ID) || variant.Appearance != "light" && variant.Appearance != "dark" {
				return fmt.Errorf("invalid custom theme variant")
			}
			if entryVariantIDs[variant.ID] {
				return fmt.Errorf("custom theme entry %q contains duplicate variant id %q", entry.ID, variant.ID)
			}
			entryVariantIDs[variant.ID] = true
			if _, err := validateEditableDocument(variant.Document); err != nil {
				return err
			}
		}
	}
	return nil
}

// Route handlers are registered by server.go so all theme operations remain
// inside the existing authenticated daemon wrapper.
func (d *Daemon) handleThemeLibrary(w http.ResponseWriter, _ *http.Request) {
	if d.themeLibrary == nil {
		writeError(w, 503, fmt.Errorf("theme library unavailable"))
		return
	}
	writeJSON(w, 200, map[string]any{"entries": d.themeLibrary.snapshot()})
}
func (d *Daemon) handlePreviewThemeSource(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil {
		writeError(w, 400, fmt.Errorf("choose a local theme source"))
		return
	}
	preview, err := compileThemePreview(body.Path)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	writeJSON(w, 200, preview)
}
func (d *Daemon) handleImportReviewedTheme(w http.ResponseWriter, r *http.Request) {
	if d.themeLibrary == nil {
		writeError(w, 503, fmt.Errorf("theme library unavailable"))
		return
	}
	var body struct {
		Path     string   `json:"path"`
		Digest   string   `json:"digest"`
		Mode     string   `json:"mode"`
		Selected []string `json:"selected"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&body); err != nil {
		writeError(w, 400, fmt.Errorf("invalid theme selection"))
		return
	}
	entry, err := d.themeLibrary.importReviewed(body.Path, body.Digest, body.Mode, body.Selected)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	writeJSON(w, 201, entry)
}
func (d *Daemon) handleLinkThemeSource(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	if d.themeLibrary == nil {
		writeError(w, 503, fmt.Errorf("theme library unavailable"))
		return
	}
	entry, err := d.themeLibrary.link(body.Path, body.Name)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	writeJSON(w, 201, entry)
}
func (d *Daemon) handleReloadThemeSource(w http.ResponseWriter, r *http.Request) {
	if d.themeLibrary == nil {
		writeError(w, 503, fmt.Errorf("theme library unavailable"))
		return
	}
	if err := d.themeLibrary.reload(r.PathValue("id")); err != nil {
		writeError(w, 400, err)
		return
	}
	writeJSON(w, 200, map[string]any{"entries": d.themeLibrary.snapshot()})
}
func (d *Daemon) handleUnlinkThemeSource(w http.ResponseWriter, r *http.Request) {
	if d.themeLibrary == nil {
		writeError(w, 503, fmt.Errorf("theme library unavailable"))
		return
	}
	if err := d.themeLibrary.unlink(r.PathValue("id")); err != nil {
		writeError(w, 400, err)
		return
	}
	writeJSON(w, 200, map[string]any{"entries": d.themeLibrary.snapshot()})
}
func (d *Daemon) handleDuplicateThemeSource(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, err)
		return
	}
	if d.themeLibrary == nil {
		writeError(w, 503, fmt.Errorf("theme library unavailable"))
		return
	}
	entry, err := d.themeLibrary.duplicate(r.PathValue("id"), body.Mode)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	writeJSON(w, 201, entry)
}
func (d *Daemon) handleRemoveThemeSource(w http.ResponseWriter, r *http.Request) {
	if d.themeLibrary == nil {
		writeError(w, 503, fmt.Errorf("theme library unavailable"))
		return
	}
	if err := d.themeLibrary.remove(r.PathValue("id")); err != nil {
		writeError(w, 404, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
