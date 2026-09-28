package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

// The account API contains display metadata only. Provider credentials and
// protocol frames never leave the daemon or enter an HTTP error response.
type AgentUsageWindow struct {
	Label        string  `json:"label"`
	UsedFraction float64 `json:"used_fraction"`
	ResetsAt     *int64  `json:"resets_at,omitempty"` // Unix seconds
}

type AgentAccount struct {
	ID             string             `json:"id"`
	Provider       string             `json:"provider"`
	Email          string             `json:"email,omitempty"`
	PlanLabel      string             `json:"plan_label,omitempty"`
	AuthKind       string             `json:"auth_kind"`
	Active         bool               `json:"active"`
	Switchable     bool               `json:"switchable"`
	UsageWindows   []AgentUsageWindow `json:"usage_windows"`
	UsageFetchedAt *int64             `json:"usage_fetched_at,omitempty"` // Unix milliseconds
	UsageError     string             `json:"usage_error,omitempty"`
}

type AgentAccountWarning struct {
	Provider string `json:"provider"`
	Message  string `json:"message"`
}

type AgentAccountsSnapshot struct {
	Accounts []AgentAccount        `json:"accounts"`
	Warnings []AgentAccountWarning `json:"warnings"`
}

func (d *Daemon) handleAgentAccounts(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("refresh") == "1"
	d.accountMu.Lock()
	cached, cachedAt := d.accountCache, d.accountCacheAt
	d.accountMu.Unlock()
	if cached != nil && !force && time.Since(cachedAt) < time.Minute {
		writeJSON(w, http.StatusOK, cached)
		return
	}
	// A refresh can launch an app-server process and make a network usage read.
	// Serialize those probes, then recheck the cache for waiting callers.
	d.accountProbeMu.Lock()
	defer d.accountProbeMu.Unlock()
	d.accountMu.Lock()
	cached, cachedAt = d.accountCache, d.accountCacheAt
	d.accountMu.Unlock()
	if cached != nil && !force && time.Since(cachedAt) < time.Minute {
		writeJSON(w, http.StatusOK, cached)
		return
	}
	if force && cached != nil && time.Since(cachedAt) < 30*time.Second {
		// A manual refresh must still notice an external CLI sign-in immediately.
		// Re-snapshot its live credentials, but avoid another quota network probe
		// when the account identities are unchanged.
		rows, activeID, warnings := d.codexSlotRows()
		cachedActive, cachedSaved := "", 0
		for _, account := range cached.Accounts {
			if account.Active {
				cachedActive = account.ID
			}
			if account.Switchable {
				cachedSaved++
			}
		}
		sameActive := activeID == cachedActive || activeID == "" && (cachedActive == "" || cachedActive == "codex-active")
		if len(warnings) == 0 && sameActive && cachedSaved == len(rows) {
			writeJSON(w, http.StatusOK, cached)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 9*time.Second)
	defer cancel()
	snapshot := d.probeCodexAccounts(ctx)
	d.accountMu.Lock()
	d.accountCache, d.accountCacheAt = &snapshot, time.Now()
	d.accountMu.Unlock()
	writeJSON(w, http.StatusOK, snapshot)
}

func (d *Daemon) probeCodexAccounts(ctx context.Context) AgentAccountsSnapshot {
	snapshot := AgentAccountsSnapshot{Accounts: []AgentAccount{}, Warnings: []AgentAccountWarning{}}
	snapshot.Accounts, _, snapshot.Warnings = d.codexSlotRows()
	program, err := resolveProgram("codex")
	if err != nil {
		return snapshot
	}
	rpc, err := startProviderRPC(program, []string{"app-server"}, Session{ID: "account-probe", WorktreePath: d.config.DataDir}, false)
	if err != nil {
		snapshot.Warnings = append(snapshot.Warnings, AgentAccountWarning{Provider: "codex", Message: "Codex account status could not start. Retry after checking its CLI."})
		return snapshot
	}
	defer func() {
		rpc.stop()
		select {
		case <-rpc.processDone:
		case <-time.After(3 * time.Second):
		}
	}()
	go func() {
		for frame := range rpc.events {
			rpc.consume(frame)
		}
	}()
	_, err = rpc.request(ctx, "initialize", map[string]any{"clientInfo": map[string]string{"name": "openade", "title": "OpenADE", "version": "0.4.0"}, "capabilities": map[string]bool{"experimentalApi": true}})
	if err == nil {
		err = rpc.notify(ctx, "initialized", map[string]any{})
	}
	if err != nil {
		snapshot.Warnings = append(snapshot.Warnings, AgentAccountWarning{Provider: "codex", Message: "Codex account status is unavailable. Refresh to retry."})
		return snapshot
	}
	data, err := rpc.request(ctx, "account/read", map[string]any{"refreshToken": false})
	if err != nil {
		snapshot.Warnings = append(snapshot.Warnings, AgentAccountWarning{Provider: "codex", Message: "Codex account status is unavailable. Refresh to retry."})
		return snapshot
	}
	var response struct {
		Account *struct {
			Type     string `json:"type"`
			Email    string `json:"email"`
			PlanType string `json:"planType"`
		} `json:"account"`
	}
	if json.Unmarshal(data, &response) != nil {
		snapshot.Warnings = append(snapshot.Warnings, AgentAccountWarning{Provider: "codex", Message: "Codex returned an unreadable account status."})
		return snapshot
	}
	if response.Account == nil {
		return snapshot
	}
	account := AgentAccount{ID: "codex-active", Provider: "codex", Active: true, Switchable: false, UsageWindows: []AgentUsageWindow{}}
	activeIndex := -1
	for index, row := range snapshot.Accounts {
		if row.Active {
			activeIndex = index
			account = row
			break
		}
	}
	switch response.Account.Type {
	case "chatgpt":
		if account.Email != "" && response.Account.Email != "" && !strings.EqualFold(account.Email, response.Account.Email) {
			snapshot.Warnings = append(snapshot.Warnings, AgentAccountWarning{Provider: "codex", Message: "The Codex login changed while quota was being read. Refresh to verify the active account."})
			return snapshot
		}
		account.AuthKind = "oauth"
		if response.Account.Email != "" {
			account.Email = strings.TrimSpace(response.Account.Email)
		}
		if len(account.Email) > 254 {
			account.Email = account.Email[:254]
		}
		account.PlanLabel = codexPlanLabel(response.Account.PlanType)
	case "apiKey":
		account.AuthKind, account.PlanLabel = "api-key", "API key"
	case "amazonBedrock":
		account.AuthKind, account.PlanLabel = "external", "Amazon Bedrock"
	default:
		snapshot.Warnings = append(snapshot.Warnings, AgentAccountWarning{Provider: "codex", Message: "Codex returned an account type this build does not recognize."})
		return snapshot
	}
	if response.Account.Type == "chatgpt" {
		limits, limitErr := rpc.request(ctx, "account/rateLimits/read", map[string]any{"excludeResetCreditDetails": true})
		if limitErr != nil {
			account.UsageError = "Quota unavailable from Codex. Refresh to retry."
		} else {
			windows, plan, parseErr := codexRateWindows(limits)
			if parseErr != nil {
				account.UsageError = "Codex returned an unreadable quota snapshot."
			} else {
				account.UsageWindows = windows
				if plan != "" {
					account.PlanLabel = codexPlanLabel(plan)
				}
				now := time.Now().UnixMilli()
				account.UsageFetchedAt = &now
			}
		}
	}
	if activeIndex >= 0 {
		snapshot.Accounts[activeIndex] = account
	} else {
		snapshot.Accounts = append(snapshot.Accounts, account)
	}
	return snapshot
}

func codexPlanLabel(plan string) string {
	plan = strings.TrimSpace(plan)
	if plan == "" {
		return ""
	}
	return "ChatGPT " + strings.ToUpper(plan[:1]) + plan[1:]
}

func codexRateWindows(data json.RawMessage) ([]AgentUsageWindow, string, error) {
	var response struct {
		RateLimits struct {
			PlanType  string           `json:"planType"`
			LimitName string           `json:"limitName"`
			Primary   *codexRateWindow `json:"primary"`
			Secondary *codexRateWindow `json:"secondary"`
		} `json:"rateLimits"`
		ByID map[string]struct {
			PlanType  string           `json:"planType"`
			LimitName string           `json:"limitName"`
			Primary   *codexRateWindow `json:"primary"`
			Secondary *codexRateWindow `json:"secondary"`
		} `json:"rateLimitsByLimitId"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, "", fmt.Errorf("invalid quota snapshot")
	}
	appendWindow := func(into []AgentUsageWindow, prefix, label string, value *codexRateWindow) []AgentUsageWindow {
		if value == nil || value.UsedPercent == nil || math.IsNaN(*value.UsedPercent) || math.IsInf(*value.UsedPercent, 0) {
			return into
		}
		used := math.Max(0, math.Min(1, *value.UsedPercent/100))
		if value.WindowDurationMins != nil {
			label = codexWindowLabel(*value.WindowDurationMins)
		}
		if prefix != "" {
			label = prefix + " · " + label
		}
		return append(into, AgentUsageWindow{Label: label, UsedFraction: used, ResetsAt: value.ResetsAt})
	}
	windows := []AgentUsageWindow{}
	plan := response.RateLimits.PlanType
	if len(response.ByID) > 0 {
		keys := make([]string, 0, len(response.ByID))
		for key := range response.ByID {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			if keys[i] == "codex" {
				return true
			}
			if keys[j] == "codex" {
				return false
			}
			return keys[i] < keys[j]
		})
		for _, key := range keys {
			bucket := response.ByID[key]
			prefix := strings.TrimSpace(bucket.LimitName)
			if prefix == "" {
				prefix = key
			}
			windows = appendWindow(windows, prefix, "Session", bucket.Primary)
			windows = appendWindow(windows, prefix, "Week", bucket.Secondary)
			if key == "codex" && bucket.PlanType != "" {
				plan = bucket.PlanType
			}
		}
	} else {
		windows = appendWindow(windows, "", "Session", response.RateLimits.Primary)
		windows = appendWindow(windows, "", "Week", response.RateLimits.Secondary)
	}
	if len(windows) == 0 {
		return windows, plan, fmt.Errorf("quota windows unavailable")
	}
	return windows, plan, nil
}

type codexRateWindow struct {
	UsedPercent        *float64 `json:"usedPercent"`
	WindowDurationMins *int64   `json:"windowDurationMins"`
	ResetsAt           *int64   `json:"resetsAt"`
}

func codexWindowLabel(minutes int64) string {
	if minutes >= 28*24*60 {
		return "Month"
	}
	if minutes >= 5*24*60 {
		return "Week"
	}
	return "Session"
}
