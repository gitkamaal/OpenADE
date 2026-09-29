package daemon

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const maxCodexAuthBytes = 2 * 1024 * 1024

var accountSlotID = regexp.MustCompile(`^[0-9a-f]{16}$`)

// Slot files contain credentials and are never serialized to the HTTP API.
// The stable ID distinguishes a user's seat within a shared Team workspace.
type codexAccountSlot struct {
	ID          string          `json:"id"`
	AccountKey  string          `json:"account_key"`
	Email       string          `json:"email"`
	PlanLabel   string          `json:"plan_label,omitempty"`
	AuthKind    string          `json:"auth_kind"`
	Credentials json.RawMessage `json:"credentials"`
	CreatedAt   int64           `json:"created_at"`
	SavedAt     int64           `json:"saved_at"`
}

func codexHome() string {
	if value := strings.TrimSpace(os.Getenv("CODEX_HOME")); value != "" {
		return value
	}
	return filepath.Join(providerHome(), ".codex")
}

func codexAuthPath() string { return filepath.Join(codexHome(), "auth.json") }

func codexSlotDir(dataDir string) string { return filepath.Join(dataDir, "agent-accounts", "codex") }

func codexSlotKey(key string) string {
	digest := sha256.Sum256([]byte("codex:" + key))
	return hex.EncodeToString(digest[:])[:16]
}

func parseCodexAuth(raw []byte) (codexAccountSlot, error) {
	var auth struct {
		OpenAIAPIKey string `json:"OPENAI_API_KEY"`
		Tokens       struct {
			IDToken string `json:"id_token"`
		} `json:"tokens"`
	}
	if !json.Valid(raw) || json.Unmarshal(raw, &auth) != nil {
		return codexAccountSlot{}, errors.New("Codex auth is not valid JSON")
	}
	if auth.Tokens.IDToken != "" {
		parts := strings.Split(auth.Tokens.IDToken, ".")
		if len(parts) < 2 {
			return codexAccountSlot{}, errors.New("Codex login identity is unavailable")
		}
		payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
		if err != nil {
			return codexAccountSlot{}, errors.New("Codex login identity is unavailable")
		}
		var claims struct {
			Email string `json:"email"`
			Auth  struct {
				AccountID    string `json:"chatgpt_account_id"`
				UserID       string `json:"chatgpt_user_id"`
				LegacyUserID string `json:"user_id"`
				PlanType     string `json:"chatgpt_plan_type"`
			} `json:"https://api.openai.com/auth"`
		}
		if json.Unmarshal(payload, &claims) != nil || strings.TrimSpace(claims.Email) == "" || len(claims.Email) > 254 {
			return codexAccountSlot{}, errors.New("Codex login identity is unavailable")
		}
		key := claims.Email
		user := claims.Auth.UserID
		if user == "" {
			user = claims.Auth.LegacyUserID
		}
		if claims.Auth.AccountID != "" {
			if user == "" {
				user = claims.Email
			}
			key = user + "::" + claims.Auth.AccountID
		}
		return codexAccountSlot{ID: codexSlotKey(key), AccountKey: key, Email: claims.Email, PlanLabel: codexPlanLabel(claims.Auth.PlanType), AuthKind: "oauth", Credentials: append(json.RawMessage(nil), raw...)}, nil
	}
	if auth.OpenAIAPIKey != "" {
		digest := sha256.Sum256([]byte(auth.OpenAIAPIKey))
		key := "api-key:" + hex.EncodeToString(digest[:])[:12]
		return codexAccountSlot{ID: codexSlotKey(key), AccountKey: key, Email: "API key", PlanLabel: "API key", AuthKind: "api-key", Credentials: append(json.RawMessage(nil), raw...)}, nil
	}
	return codexAccountSlot{}, errors.New("Codex auth has no recognized login")
}

func readPrivateJSON(path string, limit int64) ([]byte, error) {
	pathInfo, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !pathInfo.Mode().IsRegular() || pathInfo.Size() > limit {
		return nil, errors.New("private account file is unreadable")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > limit {
		return nil, errors.New("private account file is unreadable")
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, errors.New("private account file is unreadable")
	}
	return raw, nil
}

func readLiveCodexSlot() (codexAccountSlot, bool, error) {
	raw, err := readPrivateJSON(codexAuthPath(), maxCodexAuthBytes)
	if errors.Is(err, os.ErrNotExist) {
		return codexAccountSlot{}, false, nil
	}
	if err != nil {
		return codexAccountSlot{}, false, err
	}
	slot, err := parseCodexAuth(raw)
	return slot, true, err
}

func ensurePrivateDir(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&0077 != 0 {
		return errors.New("account storage must be an owner-only directory")
	}
	return nil
}

func writePrivateAtomic(path string, data []byte) error {
	// Slot callers enforce an owner-only directory. CODEX_HOME is owned by the
	// CLI and may already have broader directory permissions; never chmod or
	// reject that existing user configuration while replacing its 0600 file.
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".openade-account-")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	if err := file.Chmod(0600); err != nil {
		file.Close()
		return err
	}
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp, path); err != nil {
		return err
	}
	return nil
}

func loadCodexSlots(dataDir string) []codexAccountSlot {
	dir := codexSlotDir(dataDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	slots := []codexAccountSlot{}
	for _, entry := range entries {
		name := entry.Name()
		if entry.Type()&os.ModeSymlink != 0 || !strings.HasSuffix(name, ".json") || !accountSlotID.MatchString(strings.TrimSuffix(name, ".json")) {
			continue
		}
		raw, err := readPrivateJSON(filepath.Join(dir, name), maxCodexAuthBytes+4096)
		if err != nil {
			continue
		}
		var slot codexAccountSlot
		if json.Unmarshal(raw, &slot) != nil || slot.ID != strings.TrimSuffix(name, ".json") || slot.ID != codexSlotKey(slot.AccountKey) || slot.CreatedAt <= 0 {
			continue
		}
		parsed, err := parseCodexAuth(slot.Credentials)
		if err != nil || parsed.ID != slot.ID {
			continue
		}
		slot.Email, slot.PlanLabel, slot.AuthKind = parsed.Email, parsed.PlanLabel, parsed.AuthKind
		slots = append(slots, slot)
	}
	sort.Slice(slots, func(i, j int) bool {
		if slots[i].CreatedAt == slots[j].CreatedAt {
			return slots[i].ID < slots[j].ID
		}
		return slots[i].CreatedAt < slots[j].CreatedAt
	})
	return slots
}

func saveCodexSlot(dataDir string, slot codexAccountSlot) error {
	dir := codexSlotDir(dataDir)
	if err := ensurePrivateDir(dir); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	newest := int64(0)
	for _, existing := range loadCodexSlots(dataDir) {
		if existing.CreatedAt > newest {
			newest = existing.CreatedAt
		}
		if existing.ID == slot.ID {
			slot.CreatedAt = existing.CreatedAt
		}
	}
	if slot.CreatedAt == 0 {
		slot.CreatedAt = max(now, newest+1)
	}
	slot.SavedAt = now
	data, err := json.Marshal(slot)
	if err != nil {
		return err
	}
	return writePrivateAtomic(filepath.Join(dir, slot.ID+".json"), data)
}

func (d *Daemon) codexSlotRows() ([]AgentAccount, string, []AgentAccountWarning, bool) {
	warnings := []AgentAccountWarning{}
	live, exists, err := readLiveCodexSlot()
	if err != nil {
		warnings = append(warnings, AgentAccountWarning{Provider: "codex", Message: "Codex's live login could not be read. Saved accounts remain available."})
	}
	if err == nil && exists {
		if writeErr := saveCodexSlot(d.config.DataDir, live); writeErr != nil {
			warnings = append(warnings, AgentAccountWarning{Provider: "codex", Message: "The live Codex login could not be backed up for switching."})
		}
	}
	slots := loadCodexSlots(d.config.DataDir)
	rows := make([]AgentAccount, 0, len(slots))
	for _, slot := range slots {
		active := err == nil && exists && slot.ID == live.ID
		rows = append(rows, AgentAccount{ID: slot.ID, Provider: "codex", Email: slot.Email, PlanLabel: slot.PlanLabel, AuthKind: slot.AuthKind, Active: active, Switchable: true, UsageWindows: []AgentUsageWindow{}})
	}
	activeID := ""
	if err == nil && exists {
		activeID = live.ID
	}
	return rows, activeID, warnings, err != nil
}

func codexMutationTarget(dataDir, id string) (codexAccountSlot, error) {
	if !accountSlotID.MatchString(id) {
		return codexAccountSlot{}, errors.New("unknown account")
	}
	for _, slot := range loadCodexSlots(dataDir) {
		if slot.ID == id {
			return slot, nil
		}
	}
	return codexAccountSlot{}, errors.New("that saved account no longer exists")
}

func (d *Daemon) handleActivateCodexAccount(w http.ResponseWriter, r *http.Request) {
	d.accountProbeMu.Lock()
	defer d.accountProbeMu.Unlock()
	current, exists, err := readLiveCodexSlot()
	if err != nil {
		writeError(w, http.StatusConflict, errors.New("Codex's live login is unreadable; it was not replaced"))
		return
	}
	if exists {
		if err = saveCodexSlot(d.config.DataDir, current); err != nil {
			writeError(w, 500, errors.New("the current Codex login could not be backed up"))
			return
		}
	}
	target, err := codexMutationTarget(d.config.DataDir, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if exists && current.ID == target.ID {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if info, statErr := os.Lstat(codexAuthPath()); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		writeError(w, http.StatusConflict, errors.New("Codex auth.json is a symlink and cannot be safely replaced"))
		return
	}
	if err = writePrivateAtomic(codexAuthPath(), target.Credentials); err != nil {
		writeError(w, 500, errors.New("Codex account switch failed"))
		return
	}
	verified, ok, verifyErr := readLiveCodexSlot()
	if verifyErr != nil || !ok || verified.ID != target.ID {
		var restoreErr error
		if exists {
			restoreErr = writePrivateAtomic(codexAuthPath(), current.Credentials)
		} else {
			restoreErr = os.Remove(codexAuthPath())
		}
		if restoreErr != nil {
			writeError(w, 500, errors.New("Codex account switch could not be verified or restored; the previous login remains saved in OpenADE"))
			return
		}
		writeError(w, 500, errors.New("Codex account switch could not be verified"))
		return
	}
	d.accountMu.Lock()
	d.accountCache = nil
	d.accountMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (d *Daemon) handleForgetCodexAccount(w http.ResponseWriter, r *http.Request) {
	d.accountProbeMu.Lock()
	defer d.accountProbeMu.Unlock()
	id := r.PathValue("id")
	target, err := codexMutationTarget(d.config.DataDir, id)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	live, exists, err := readLiveCodexSlot()
	if err != nil {
		writeError(w, http.StatusConflict, errors.New("Codex's live login is unreadable; refresh before forgetting an account"))
		return
	}
	active := exists && live.ID == id
	if active {
		if info, statErr := os.Lstat(codexAuthPath()); statErr != nil || info.Mode()&os.ModeSymlink != 0 {
			writeError(w, http.StatusConflict, errors.New("Codex auth.json changed; refresh before forgetting"))
			return
		}
		fresh, still, readErr := readLiveCodexSlot()
		if readErr != nil || !still || fresh.ID != target.ID {
			writeError(w, http.StatusConflict, errors.New("The live Codex login changed; refresh before forgetting"))
			return
		}
		if err = os.Remove(codexAuthPath()); err != nil {
			writeError(w, 500, errors.New("Codex could not sign out"))
			return
		}
	}
	file := filepath.Join(codexSlotDir(d.config.DataDir), id+".json")
	if err = os.Remove(file); err != nil {
		if active {
			if restoreErr := writePrivateAtomic(codexAuthPath(), live.Credentials); restoreErr != nil {
				writeError(w, 500, errors.New("The active Codex login could not be restored; its saved copy remains in OpenADE"))
				return
			}
		}
		writeError(w, 500, errors.New("The saved Codex account could not be forgotten"))
		return
	}
	d.accountMu.Lock()
	d.accountCache = nil
	d.accountMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}
