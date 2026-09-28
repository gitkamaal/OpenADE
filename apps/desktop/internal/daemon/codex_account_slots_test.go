package daemon

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func fixtureCodexAuth(t *testing.T, email, user, workspace string) []byte {
	t.Helper()
	claims := map[string]any{"email": email, "https://api.openai.com/auth": map[string]string{"chatgpt_user_id": user, "chatgpt_account_id": workspace, "chatgpt_plan_type": "plus"}}
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	idToken := "header." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
	auth, err := json.Marshal(map[string]any{"tokens": map[string]string{"id_token": idToken, "access_token": "PRIVATE_FIXTURE_ACCESS_TOKEN"}, "last_refresh": "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	return auth
}

func TestCodexSlotsSnapshotSwitchAndForgetStayInsideIsolatedHome(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "codex-home")
	dataDir := filepath.Join(root, "openade-data")
	t.Setenv("CODEX_HOME", home)
	if err := os.MkdirAll(home, 0755); err != nil {
		t.Fatal(err)
	}
	first := fixtureCodexAuth(t, "first@example.test", "user-one", "team-space")
	second := fixtureCodexAuth(t, "second@example.test", "user-two", "team-space")
	if err := os.WriteFile(codexAuthPath(), first, 0600); err != nil {
		t.Fatal(err)
	}
	d := &Daemon{config: Config{DataDir: dataDir}}
	rows, firstID, warnings := d.codexSlotRows()
	if len(warnings) != 0 || len(rows) != 1 || !rows[0].Active || !rows[0].Switchable {
		t.Fatal("first account was not backed up")
	}
	if err := os.WriteFile(codexAuthPath(), second, 0600); err != nil {
		t.Fatal(err)
	}
	rows, secondID, warnings := d.codexSlotRows()
	if len(warnings) != 0 || len(rows) != 2 || firstID == secondID || !rows[1].Active || rows[0].Active {
		t.Fatal("second account was not added without losing the first")
	}
	for _, slot := range loadCodexSlots(dataDir) {
		info, err := os.Stat(filepath.Join(codexSlotDir(dataDir), slot.ID+".json"))
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("saved account credentials were not owner-only")
		}
	}
	activate := httptest.NewRequest(http.MethodPost, "/api/agent-accounts/codex/"+firstID+"/activate", nil)
	activate.SetPathValue("id", firstID)
	result := httptest.NewRecorder()
	d.handleActivateCodexAccount(result, activate)
	if result.Code != http.StatusNoContent {
		t.Fatalf("switch status=%d", result.Code)
	}
	live, exists, err := readLiveCodexSlot()
	if err != nil || !exists || live.ID != firstID {
		t.Fatal("switch did not activate the selected fixture account")
	}
	forgetSaved := httptest.NewRequest(http.MethodDelete, "/api/agent-accounts/codex/"+secondID, nil)
	forgetSaved.SetPathValue("id", secondID)
	result = httptest.NewRecorder()
	d.handleForgetCodexAccount(result, forgetSaved)
	if result.Code != http.StatusNoContent || len(loadCodexSlots(dataDir)) != 1 {
		t.Fatal("inactive account was not forgotten")
	}
	forgetActive := httptest.NewRequest(http.MethodDelete, "/api/agent-accounts/codex/"+firstID, nil)
	forgetActive.SetPathValue("id", firstID)
	result = httptest.NewRecorder()
	d.handleForgetCodexAccount(result, forgetActive)
	if result.Code != http.StatusNoContent || len(loadCodexSlots(dataDir)) != 0 {
		t.Fatal("active account was not forgotten")
	}
	if _, err := os.Stat(codexAuthPath()); !os.IsNotExist(err) {
		t.Fatal("active Codex login remains after forget")
	}
	bad := httptest.NewRequest(http.MethodDelete, "/api/agent-accounts/codex/../../outside", nil)
	bad.SetPathValue("id", "../../outside")
	result = httptest.NewRecorder()
	d.handleForgetCodexAccount(result, bad)
	if result.Code != http.StatusNotFound {
		t.Fatal("invalid slot id reached a file mutation")
	}
}

func TestCodexAccountSlotsRefuseMalformedLiveAuthBeforeSwitch(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "codex-home")
	t.Setenv("CODEX_HOME", home)
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	valid := fixtureCodexAuth(t, "safe@example.test", "user", "workspace")
	if err := os.WriteFile(codexAuthPath(), valid, 0600); err != nil {
		t.Fatal(err)
	}
	d := &Daemon{config: Config{DataDir: filepath.Join(root, "data")}}
	_, id, _ := d.codexSlotRows()
	broken := []byte(`{"tokens":{"id_token":"not-a-jwt"}}`)
	if err := os.WriteFile(codexAuthPath(), broken, 0600); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/agent-accounts/codex/"+id+"/activate", nil)
	request.SetPathValue("id", id)
	response := httptest.NewRecorder()
	d.handleActivateCodexAccount(response, request)
	if response.Code != http.StatusConflict {
		t.Fatal("malformed live auth was replaced")
	}
	still, err := os.ReadFile(codexAuthPath())
	if err != nil || string(still) != string(broken) {
		t.Fatal("malformed live auth changed")
	}
	if strings.Contains(response.Body.String(), "PRIVATE_FIXTURE_ACCESS_TOKEN") {
		t.Fatal("credential leaked in mutation error")
	}
}

func TestCodexAccountSlotsRejectNonregularAuthBeforeOpen(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "codex-home")
	t.Setenv("CODEX_HOME", home)
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(codexAuthPath(), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readLiveCodexSlot(); err == nil {
		t.Fatal("FIFO auth file was accepted")
	}
	if err := os.Remove(codexAuthPath()); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "target.json")
	if err := os.WriteFile(target, fixtureCodexAuth(t, "safe@example.test", "user", "workspace"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, codexAuthPath()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readLiveCodexSlot(); err == nil {
		t.Fatal("symlink auth file was accepted")
	}
}
