package daemon

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const historyPageSize = 100
const historyFormat = "%H%x00%P%x00%s%x00%an%x00%ae%x00%aI%x00"

type historyRef struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

type historyCommit struct {
	SHA     string       `json:"sha"`
	Parents string       `json:"parents"`
	Subject string       `json:"subject"`
	Author  string       `json:"author"`
	Email   string       `json:"email"`
	Date    string       `json:"date"`
	Refs    []historyRef `json:"refs"`
}

type historyComparison struct {
	Base   string `json:"base"`
	Ahead  int    `json:"ahead"`
	Behind int    `json:"behind"`
}

type historyPage struct {
	Branch          string             `json:"branch"`
	Commits         []historyCommit    `json:"commits"`
	BranchTips      []historyCommit    `json:"branch_tips"`
	HeadSHA         string             `json:"head_sha"`
	NextCursor      *int               `json:"next_cursor"`
	TotalCount      *int               `json:"total_count"`
	HeadCommitCount *int               `json:"head_commit_count"`
	Comparison      *historyComparison `json:"comparison,omitempty"`
}

func parseHistoryRefs(output string) map[string][]historyRef {
	result := make(map[string][]historyRef)
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Split(line, "\x00")
		if len(fields) < 6 || fields[5] != "" {
			continue // Ignore symbolic remote HEAD refs.
		}
		name, objectSHA, objectType, peeledSHA, peeledType := fields[0], fields[1], fields[2], fields[3], fields[4]
		kind, label := "", ""
		switch {
		case strings.HasPrefix(name, "refs/heads/"):
			kind, label = "branch", strings.TrimPrefix(name, "refs/heads/")
		case strings.HasPrefix(name, "refs/remotes/"):
			kind, label = "remote", strings.TrimPrefix(name, "refs/remotes/")
		case strings.HasPrefix(name, "refs/tags/"):
			kind, label = "tag", strings.TrimPrefix(name, "refs/tags/")
		}
		sha := objectSHA
		if objectType == "tag" && peeledType == "commit" {
			sha = peeledSHA
		} else if objectType != "commit" {
			continue
		}
		if label == "" || !validCommitSHA(sha) {
			continue
		}
		result[sha] = append(result[sha], historyRef{Kind: kind, Label: label})
	}
	priority := map[string]int{"branch": 0, "tag": 1, "remote": 2}
	for sha := range result {
		sort.Slice(result[sha], func(i, j int) bool {
			a, b := result[sha][i], result[sha][j]
			if priority[a.Kind] != priority[b.Kind] {
				return priority[a.Kind] < priority[b.Kind]
			}
			return a.Label < b.Label
		})
	}
	return result
}

func historyRecord(fields []string, refs map[string][]historyRef) (historyCommit, bool) {
	if len(fields) != 6 {
		return historyCommit{}, false
	}
	sha := strings.TrimLeft(fields[0], "\r\n")
	if !validCommitSHA(sha) {
		return historyCommit{}, false
	}
	return historyCommit{
		SHA: sha, Parents: fields[1], Subject: fields[2], Author: fields[3], Email: fields[4],
		Date: fields[5], Refs: append([]historyRef{}, refs[sha]...),
	}, true
}

func parseHistoryLog(output string, refs map[string][]historyRef) []historyCommit {
	commits := []historyCommit{}
	fields := strings.Split(output, "\x00")
	for len(fields) >= 6 {
		if commit, ok := historyRecord(fields[:6], refs); ok {
			commits = append(commits, commit)
		}
		fields = fields[6:]
	}
	return commits
}

func historyLogArgs(headSHA string, extra ...string) []string {
	args := []string{"log", "--topo-order", "--no-color", "--no-decorate", "--no-show-signature", "--no-patch"}
	args = append(args, extra...)
	args = append(args, "--format="+historyFormat)
	if headSHA != "" {
		args = append(args, "HEAD")
	}
	return append(args, "--branches", "--remotes", "--tags")
}

func historyMatch(query string, commit historyCommit) bool {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return true
	}
	if strings.HasPrefix(strings.ToLower(commit.SHA), query) {
		return true
	}
	needle := []rune(query)
	index := 0
	for _, character := range strings.ToLower(commit.SHA + " " + commit.Subject) {
		if character == needle[index] {
			index++
			if index == len(needle) {
				return true
			}
		}
	}
	return false
}

// Search reads Git's output as a stream, so searching a large repository does
// not require loading its full history into the daemon or the WebView.
func searchHistory(ctx context.Context, repo, headSHA, query string, cursor, limit int, refs map[string][]historyRef) ([]historyCommit, int, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	args := append([]string{"-C", repo}, historyLogArgs(headSHA)...)
	cmd := exec.CommandContext(ctx, "git", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, 0, err
	}
	stderr := boundedGitOutput{limit: 512 * 1024}
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, 0, err
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	scanner.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		if index := bytes.IndexByte(data, 0); index >= 0 {
			return index + 1, data[:index], nil
		}
		if atEOF && len(data) > 0 {
			return len(data), data, nil
		}
		return 0, nil, nil
	})
	commits := []historyCommit{}
	fields := make([]string, 0, 6)
	count := 0
	for scanner.Scan() {
		fields = append(fields, scanner.Text())
		if len(fields) != 6 {
			continue
		}
		if commit, ok := historyRecord(fields, refs); ok && historyMatch(query, commit) {
			if count >= cursor && len(commits) < limit {
				commits = append(commits, commit)
			}
			count++
		}
		fields = fields[:0]
	}
	if scanErr := scanner.Err(); scanErr != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, 0, scanErr
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return nil, 0, fmt.Errorf("history search timed out")
		}
		return nil, 0, fmt.Errorf("git history search: %s", strings.TrimSpace(stderr.String()))
	}
	return commits, count, nil
}

func historyCount(ctx context.Context, repo string, args ...string) *int {
	output, err := gitOutput(ctx, repo, args...)
	if err != nil {
		return nil
	}
	count, err := strconv.Atoi(strings.TrimSpace(output))
	if err != nil {
		return nil
	}
	return &count
}

func historyAheadBehind(ctx context.Context, repo, branch, refsOutput string, refs map[string][]historyRef) *historyComparison {
	if branch == "HEAD" || branch == "" {
		return nil
	}
	available := map[string]bool{}
	for _, references := range refs {
		for _, reference := range references {
			if reference.Kind == "remote" {
				available[reference.Label] = true
			}
		}
	}
	candidates := []string{}
	for _, remote := range []string{"upstream", "origin"} {
		for _, line := range strings.Split(refsOutput, "\n") {
			fields := strings.Split(line, "\x00")
			if len(fields) >= 6 && fields[0] == "refs/remotes/"+remote+"/HEAD" && strings.HasPrefix(fields[5], "refs/remotes/") {
				candidates = append(candidates, strings.TrimPrefix(fields[5], "refs/remotes/"))
			}
		}
	}
	candidates = append(candidates, "upstream/main", "origin/main", "upstream/master", "origin/master")
	seen := map[string]bool{}
	for _, base := range candidates {
		if seen[base] || !available[base] {
			continue
		}
		seen[base] = true
		output, err := gitOutput(ctx, repo, "rev-list", "--left-right", "--count", "HEAD..."+base)
		if err != nil {
			continue
		}
		fields := strings.Fields(output)
		if len(fields) != 2 {
			continue
		}
		ahead, errA := strconv.Atoi(fields[0])
		behind, errB := strconv.Atoi(fields[1])
		if errA == nil && errB == nil {
			return &historyComparison{Base: base, Ahead: ahead, Behind: behind}
		}
	}
	if tracked, err := gitOutput(ctx, repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"); err == nil && tracked != "" && !seen[tracked] {
		output, err := gitOutput(ctx, repo, "rev-list", "--left-right", "--count", "HEAD..."+tracked)
		if err == nil {
			fields := strings.Fields(output)
			if len(fields) == 2 {
				ahead, errA := strconv.Atoi(fields[0])
				behind, errB := strconv.Atoi(fields[1])
				if errA == nil && errB == nil {
					return &historyComparison{Base: tracked, Ahead: ahead, Behind: behind}
				}
			}
		}
	}
	return nil
}

func (d *Daemon) handleHistory(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	cursor := 0
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		cursor, err = strconv.Atoi(raw)
		if err != nil || cursor < 0 || cursor > 10_000_000 {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid history cursor"))
			return
		}
	}
	limit := historyPageSize
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > historyPageSize {
			writeError(w, http.StatusBadRequest, fmt.Errorf("history limit must be between 1 and %d", historyPageSize))
			return
		}
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) > 256 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("history query is too long"))
		return
	}
	var branch, headSHA, refsOutput string
	var refsErr error
	var initial sync.WaitGroup
	initial.Add(3)
	go func() {
		defer initial.Done()
		branch, _ = gitOutput(r.Context(), session.WorktreePath, "branch", "--show-current")
	}()
	go func() {
		defer initial.Done()
		headSHA, _ = gitOutput(r.Context(), session.WorktreePath, "rev-parse", "--verify", "HEAD^{commit}")
	}()
	go func() {
		defer initial.Done()
		refsOutput, refsErr = gitOutput(r.Context(), session.WorktreePath, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(symref)%00", "refs/heads", "refs/remotes", "refs/tags")
	}()
	initial.Wait()
	if branch == "" {
		branch = "HEAD"
	}
	if refsErr != nil {
		writeError(w, 500, refsErr)
		return
	}
	refs := parseHistoryRefs(refsOutput)
	page := historyPage{Branch: branch, Commits: []historyCommit{}, BranchTips: []historyCommit{}, HeadSHA: headSHA}
	if headSHA == "" && len(refs) == 0 {
		zero := 0
		page.TotalCount, page.HeadCommitCount = &zero, &zero
		writeJSON(w, 200, page)
		return
	}
	if query != "" {
		var total int
		page.Commits, total, err = searchHistory(r.Context(), session.WorktreePath, headSHA, query, cursor, limit, refs)
		if err != nil {
			writeError(w, 500, err)
			return
		}
		page.TotalCount = &total
		if cursor+len(page.Commits) < total {
			next := cursor + len(page.Commits)
			page.NextCursor = &next
		}
		writeJSON(w, 200, page)
		return
	}
	var output, tipsOutput string
	var logErr error
	var totalCount, headCount *int
	var comparison *historyComparison
	var pageReads sync.WaitGroup
	pageReads.Add(1)
	go func() {
		defer pageReads.Done()
		output, logErr = gitOutput(r.Context(), session.WorktreePath, historyLogArgs(headSHA, fmt.Sprintf("--skip=%d", cursor), fmt.Sprintf("--max-count=%d", limit+1))...)
	}()
	if cursor == 0 {
		tipArgs := []string{"log", "--no-walk=sorted", "--no-color", "--no-decorate", "--no-show-signature", "--no-patch", "--format=" + historyFormat}
		if headSHA != "" {
			tipArgs = append(tipArgs, "HEAD")
		}
		tipArgs = append(tipArgs, "--branches", "--remotes")
		pageReads.Add(2)
		go func() {
			defer pageReads.Done()
			tipsOutput, _ = gitOutput(r.Context(), session.WorktreePath, tipArgs...)
		}()
		go func() {
			defer pageReads.Done()
			countArgs := []string{"rev-list", "--count"}
			if headSHA != "" {
				countArgs = append(countArgs, "HEAD")
			}
			totalCount = historyCount(r.Context(), session.WorktreePath, append(countArgs, "--branches", "--remotes", "--tags")...)
		}()
		if headSHA != "" {
			pageReads.Add(2)
			go func() {
				defer pageReads.Done()
				headCount = historyCount(r.Context(), session.WorktreePath, "rev-list", "--count", "HEAD")
			}()
			go func() {
				defer pageReads.Done()
				comparison = historyAheadBehind(r.Context(), session.WorktreePath, branch, refsOutput, refs)
			}()
		}
	}
	pageReads.Wait()
	if logErr != nil {
		writeError(w, 500, logErr)
		return
	}
	page.Commits = parseHistoryLog(output, refs)
	if len(page.Commits) > limit {
		page.Commits = page.Commits[:limit]
		next := cursor + limit
		page.NextCursor = &next
	}
	if cursor == 0 {
		page.BranchTips = parseHistoryLog(tipsOutput, refs)
		page.TotalCount, page.HeadCommitCount, page.Comparison = totalCount, headCount, comparison
	}
	writeJSON(w, 200, page)
}

func (d *Daemon) handleHistoryFetch(w http.ResponseWriter, r *http.Request) {
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "-C", session.WorktreePath, "fetch", "--all", "--quiet")
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output := boundedGitOutput{limit: 512 * 1024}
	cmd.Stderr = &output
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			writeError(w, 500, fmt.Errorf("fetch all timed out"))
		} else {
			writeError(w, 500, fmt.Errorf("fetch all: %s", strings.TrimSpace(output.String())))
		}
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
