package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const maxGitPreviewBytes = 4 * 1024 * 1024

var branchUnsafe = regexp.MustCompile(`[^a-zA-Z0-9._/-]+`)

type boundedGitOutput struct {
	buffer    bytes.Buffer
	limit     int
	truncated bool
}

func (b *boundedGitOutput) String() string { return b.buffer.String() }
func (b *boundedGitOutput) Write(p []byte) (int, error) {
	n := len(p)
	remaining := b.limit - b.buffer.Len()
	if remaining > 0 {
		take := n
		if take > remaining {
			take = remaining
		}
		_, _ = b.buffer.Write(p[:take])
	}
	if n > remaining {
		b.truncated = true
	}
	return n, nil
}

func gitOutput(ctx context.Context, repo string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	commandArgs := append([]string{"-C", repo}, args...)
	cmd := exec.CommandContext(ctx, "git", commandArgs...)
	stderr := boundedGitOutput{limit: 512 * 1024}
	stdout := boundedGitOutput{limit: maxGitPreviewBytes}
	cmd.Stderr = &stderr
	cmd.Stdout = &stdout
	err := cmd.Run()
	if stdout.truncated || stderr.truncated {
		return "", fmt.Errorf("git output exceeded the preview limit; narrow the changes or use the project terminal")
	}
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", fmt.Errorf("git %s timed out while accessing %s", strings.Join(args, " "), repo)
		}
		return "", fmt.Errorf("git %s: %s", strings.Join(args, " "), strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

func verifyRepository(ctx context.Context, repo string) (string, error) {
	root, err := gitOutput(ctx, repo, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("repository is not a Git worktree: %w", err)
	}
	return filepath.Clean(root), nil
}

func makeBranch(ticket, title, id string) string {
	prefix := "ade"
	if ticket != "" {
		prefix = strings.ToLower(ticket)
	}
	slug := strings.ToLower(strings.TrimSpace(title))
	slug = branchUnsafe.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-./")
	if len(slug) > 42 {
		slug = strings.Trim(slug[:42], "-")
	}
	if slug == "" {
		slug = "session"
	}
	return fmt.Sprintf("%s/%s-%s", prefix, slug, id[:8])
}

func createWorktree(ctx context.Context, repo, path, branch, base string) error {
	if base == "" {
		base = "HEAD"
	}
	resolved, err := gitOutput(ctx, repo, "rev-parse", "--verify", "--end-of-options", base+"^{commit}")
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "-C", repo, "worktree", "add", "-b", branch, path, resolved)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("creating the worktree timed out; grant OpenADE access to the repository folder and retry")
		}
		return fmt.Errorf("create worktree: %s", strings.TrimSpace(stderr.String()))
	}
	return nil
}

func worktreeDiff(ctx context.Context, path, base string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if strings.TrimSpace(base) == "" {
		base = "HEAD"
	}
	resolved, err := gitOutput(ctx, path, "rev-parse", "--verify", "--end-of-options", base+"^{commit}")
	if err != nil {
		return "", err
	}
	diff, err := gitOutput(ctx, path, "diff", "--no-ext-diff", "--stat", "--patch", resolved, "--")
	if err != nil {
		return "", err
	}
	untracked, err := gitOutput(ctx, path, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return "", err
	}
	for _, relative := range strings.Split(untracked, "\x00") {
		if len(diff) >= maxGitPreviewBytes {
			return "", fmt.Errorf("git output exceeded the preview limit; narrow the changes or use the project terminal")
		}
		if relative == "" {
			continue
		}
		file := filepath.Join(path, relative)
		info, err := os.Lstat(file)
		if err != nil {
			continue
		}
		if info.Size() > maxEditorBytes {
			diff += "\ndiff --git a/" + relative + " b/" + relative + "\nnew file mode 100644\nLarge file omitted from preview\n"
			continue
		}
		cmd := exec.CommandContext(ctx, "git", "diff", "--no-ext-diff", "--no-index", "--", "/dev/null", file)
		out := boundedGitOutput{limit: maxGitPreviewBytes - len(diff)}
		stderr := boundedGitOutput{limit: 512 * 1024}
		cmd.Stdout = &out
		cmd.Stderr = &stderr
		err = cmd.Run()
		if out.truncated || stderr.truncated {
			return "", fmt.Errorf("git output exceeded the preview limit; narrow the changes or use the project terminal")
		}
		if err != nil {
			exit, ok := err.(*exec.ExitError)
			if !ok || exit.ExitCode() != 1 {
				return "", err
			}
		}
		text := out.String()
		if index := strings.IndexByte(text, '\n'); index >= 0 {
			text = "diff --git a/" + relative + " b/" + relative + text[index:]
		}
		if len(diff)+len(text)+1 > maxGitPreviewBytes {
			return "", fmt.Errorf("git output exceeded the preview limit; narrow the changes or use the project terminal")
		}
		diff += "\n" + text
	}
	return diff, nil
}

func worktreeFiles(ctx context.Context, path string) ([]string, error) {
	out, err := gitOutput(ctx, path, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
	if err != nil {
		return nil, err
	}
	if out == "" {
		return []string{}, nil
	}
	files := strings.Split(strings.TrimSuffix(out, "\x00"), "\x00")
	sort.Strings(files)
	return files, nil
}

type PullRequest struct {
	Number         int    `json:"number"`
	Title          string `json:"title"`
	URL            string `json:"url"`
	State          string `json:"state"`
	IsDraft        bool   `json:"isDraft"`
	HeadRefName    string `json:"headRefName"`
	BaseRefName    string `json:"baseRefName"`
	ReviewDecision string `json:"reviewDecision"`
	UpdatedAt      string `json:"updatedAt"`
	Author         struct {
		Login string `json:"login"`
	} `json:"author"`
	Labels []struct {
		Name string `json:"name"`
	} `json:"labels"`
}

func listPullRequests(ctx context.Context, repo string) ([]PullRequest, error) {
	slug, err := githubRepoSlug(ctx, repo)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "gh", "pr", "list", "--repo", slug, "--state", "open", "--limit", "100",
		"--json", "number,title,url,state,isDraft,headRefName,baseRefName,reviewDecision,updatedAt,author,labels")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("gh pr list: %s", strings.TrimSpace(string(out)))
	}
	var prs []PullRequest
	if err := json.Unmarshal(out, &prs); err != nil {
		return nil, fmt.Errorf("decode pull requests: %w", err)
	}
	return prs, nil
}

func createPullRequest(ctx context.Context, session Session, title, body, base string) (string, error) {
	if base == "" {
		base = session.BaseBranch
	}
	if title == "" {
		title = session.Title
	}
	if session.TicketKey != "" && !strings.Contains(title, session.TicketKey) {
		title = session.TicketKey + ": " + title
	}
	if _, err := gitOutput(ctx, session.WorktreePath, "push", "-u", "origin", session.Branch); err != nil {
		return "", err
	}
	slug, err := githubRepoSlug(ctx, session.RepoRoot)
	if err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, "gh", "pr", "create", "--repo", slug, "--draft",
		"--base", base, "--head", session.Branch, "--title", title, "--body", body)
	cmd.Dir = session.WorktreePath
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("gh pr create: %s", strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func githubRepoSlug(ctx context.Context, repo string) (string, error) {
	if !strings.Contains(repo, string(filepath.Separator)) {
		return strings.TrimSuffix(repo, ".git"), nil
	}
	cmd := exec.CommandContext(ctx, "gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
	cmd.Dir = repo
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("resolve GitHub repository: %s", strings.TrimSpace(string(out)))
	}
	slug := strings.TrimSpace(string(out))
	if slug == "" {
		return "", fmt.Errorf("repository has no GitHub origin")
	}
	return slug, nil
}

type Ticket struct {
	Key       string `json:"key"`
	Summary   string `json:"summary"`
	Status    string `json:"status"`
	Assignee  string `json:"assignee"`
	URL       string `json:"url"`
	Source    string `json:"source"`
	FetchedAt string `json:"fetched_at"`
}

func fetchJiraTicket(ctx context.Context, key string) (Ticket, error) {
	ticket := Ticket{Key: key, Source: "jira-cli", FetchedAt: time.Now().UTC().Format(time.RFC3339)}
	cmd := exec.CommandContext(ctx, "jira", "issue", "view", key, "--plain")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return ticket, fmt.Errorf("Jira CLI is unavailable or not authenticated: %s", strings.TrimSpace(string(out)))
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) > 0 {
		ticket.Summary = strings.TrimSpace(lines[0])
	}
	return ticket, nil
}

// A separate index snapshots the turn without touching the user's staging area.
func snapshotWorkingTree(ctx context.Context, root string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	temporary, err := os.CreateTemp("", "openade-turn-index-*")
	if err != nil {
		return "", err
	}
	index := temporary.Name()
	temporary.Close()
	os.Remove(index)
	defer os.Remove(index)
	defer os.Remove(index + ".lock")
	run := func(args ...string) (string, error) {
		cmd := exec.CommandContext(ctx, "git", append([]string{"-C", root}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_INDEX_FILE="+index)
		out := boundedGitOutput{limit: maxGitPreviewBytes}
		stderr := boundedGitOutput{limit: 512 * 1024}
		cmd.Stdout = &out
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			return "", fmt.Errorf("turn snapshot unavailable: %s", strings.TrimSpace(stderr.String()))
		}
		if out.truncated || stderr.truncated {
			return "", fmt.Errorf("turn snapshot exceeded limit")
		}
		return strings.TrimSpace(out.String()), nil
	}
	if _, err = run("read-tree", "HEAD"); err != nil {
		return "", err
	}
	if _, err = run("add", "--all", "--", "."); err != nil {
		return "", err
	}
	return run("write-tree")
}
