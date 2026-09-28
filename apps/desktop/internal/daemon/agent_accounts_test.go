package daemon

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCodexRateWindowsPreserveUnknownRatherThanInventingZero(t *testing.T) {
	windows, plan, err := codexRateWindows(json.RawMessage(`{"rateLimits":{"planType":"plus"},"rateLimitsByLimitId":{"codex":{"planType":"pro","limitName":"Codex","primary":{"usedPercent":81.5,"windowDurationMins":300,"resetsAt":1800000000},"secondary":{"usedPercent":96,"windowDurationMins":10080,"resetsAt":1800500000}},"other":{"limitName":"Other","primary":{"windowDurationMins":300}}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if plan != "pro" || len(windows) != 2 {
		t.Fatalf("plan=%q windows=%+v", plan, windows)
	}
	if windows[0].Label != "Codex · Session" || windows[0].UsedFraction != .815 {
		t.Fatalf("primary=%+v", windows[0])
	}
	if windows[1].Label != "Codex · Week" || windows[1].UsedFraction != .96 {
		t.Fatalf("secondary=%+v", windows[1])
	}
	if _, _, err := codexRateWindows(json.RawMessage(`{"rateLimits":{"primary":{"resetsAt":1800000000}}}`)); err == nil {
		t.Fatal("missing usage percent must not become zero")
	}
}

func TestCodexAccountProbeUsesReadOnlyProtocolAndReturnsNoCredentials(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	if err := os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	fixture := `#!/usr/bin/env python3
import json,sys
for line in sys.stdin:
 frame=json.loads(line)
 if 'id' not in frame: continue
 method=frame.get('method')
 if method=='initialize': result={}
 elif method=='account/read': result={'account':{'type':'chatgpt','email':'fixture@example.test','planType':'plus','accessToken':'PRIVATE_TOKEN_NEVER_RETURN'},'requiresOpenaiAuth':True}
 elif method=='account/rateLimits/read': result={'rateLimits':{'planType':'pro','primary':{'usedPercent':40,'windowDurationMins':300,'resetsAt':1800000000}},'rateLimitsByLimitId':None,'accountId':'private-account-id'}
 else: result={}
 print(json.dumps({'jsonrpc':'2.0','id':frame['id'],'result':result}),flush=True)
`
	if err := os.WriteFile(filepath.Join(bin, "codex"), []byte(fixture), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CODEX_HOME", filepath.Join(root, "codex-home"))
	d := &Daemon{config: Config{DataDir: root}}
	snapshot := d.probeCodexAccounts(context.Background())
	if len(snapshot.Warnings) != 0 || len(snapshot.Accounts) != 1 {
		t.Fatalf("unexpected account count=%d warning count=%d", len(snapshot.Accounts), len(snapshot.Warnings))
	}
	account := snapshot.Accounts[0]
	if account.Email != "fixture@example.test" || account.PlanLabel != "ChatGPT Pro" || account.AuthKind != "oauth" || account.Switchable || len(account.UsageWindows) != 1 || account.UsageWindows[0].UsedFraction != .4 {
		t.Fatal("unexpected sanitized account metadata")
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "PRIVATE_TOKEN_NEVER_RETURN") || strings.Contains(string(encoded), "private-account-id") {
		t.Fatal("provider credentials or account ID leaked to HTTP snapshot")
	}
}
