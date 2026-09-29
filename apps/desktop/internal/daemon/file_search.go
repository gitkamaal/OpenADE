package daemon

import (
	"bufio"
	"container/heap"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const workspaceSearchLimit = 200
const workspaceSearchQueryLimit = 256
const workspaceSearchDirectoryCache = 8192

type workspaceFileSearchMatch struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Score int64  `json:"score"`
}

func (d *Daemon) handleFileSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	if query == "" || utf8.RuneCountInString(query) > workspaceSearchQueryLimit {
		writeError(w, http.StatusBadRequest, fmt.Errorf("file search needs a query of at most %d characters", workspaceSearchQueryLimit))
		return
	}
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	results, truncated, err := searchWorkspaceFiles(ctx, session.WorktreePath, query, r.URL.Query().Get("hidden") == "1", r.URL.Query().Get("ignored") == "1")
	if errors.Is(err, context.Canceled) {
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results, "truncated": truncated})
}

func searchWorkspaceFiles(ctx context.Context, root, query string, showHidden, includeIgnored bool) ([]workspaceFileSearchMatch, bool, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, false, err
	}
	if !info.IsDir() {
		return nil, false, fmt.Errorf("workspace is not a directory")
	}
	results := &workspaceSearchCollector{query: strings.ToLower(query), inHeap: make(map[string]struct{}, workspaceSearchLimit)}
	if plainProjectFolder(root) {
		err = searchPlainFolder(ctx, root, showHidden, includeIgnored, results)
	} else {
		err = searchGitWorkspace(ctx, root, showHidden, includeIgnored, results)
	}
	if err != nil {
		return nil, false, err
	}
	return results.finish()
}

type workspaceSearchCollector struct {
	query   string
	inHeap  map[string]struct{}
	matched int
	best    workspaceSearchHeap
}

func (c *workspaceSearchCollector) consider(relative, kind string) {
	if _, exists := c.inHeap[relative]; exists {
		return
	}
	name := path.Base(relative)
	score, matched := workspaceSearchScore(name, relative, c.query)
	if !matched {
		return
	}
	c.matched++
	item := workspaceFileSearchMatch{Path: relative, Name: name, Kind: kind, Score: score}
	if len(c.best) < workspaceSearchLimit {
		heap.Push(&c.best, item)
		c.inHeap[relative] = struct{}{}
	} else if searchMatchBetter(item, c.best[0]) {
		delete(c.inHeap, c.best[0].Path)
		c.best[0] = item
		c.inHeap[relative] = struct{}{}
		heap.Fix(&c.best, 0)
	}
}

func (c *workspaceSearchCollector) finish() ([]workspaceFileSearchMatch, bool, error) {
	results := append([]workspaceFileSearchMatch{}, c.best...)
	sort.Slice(results, func(i, j int) bool { return searchMatchBetter(results[i], results[j]) })
	return results, c.matched > workspaceSearchLimit, nil
}

type workspaceSearchHeap []workspaceFileSearchMatch

func (h workspaceSearchHeap) Len() int           { return len(h) }
func (h workspaceSearchHeap) Less(i, j int) bool { return searchMatchBetter(h[j], h[i]) }
func (h workspaceSearchHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *workspaceSearchHeap) Push(value any)    { *h = append(*h, value.(workspaceFileSearchMatch)) }
func (h *workspaceSearchHeap) Pop() any {
	last := len(*h) - 1
	value := (*h)[last]
	*h = (*h)[:last]
	return value
}

func searchMatchBetter(left, right workspaceFileSearchMatch) bool {
	if left.Score != right.Score {
		return left.Score > right.Score
	}
	leftFolded, rightFolded := strings.ToLower(left.Path), strings.ToLower(right.Path)
	if leftFolded != rightFolded {
		return leftFolded < rightFolded
	}
	return left.Path < right.Path
}

func workspaceSearchScore(name, relative, query string) (int64, bool) {
	if query == "" {
		return 0, true
	}
	name, relative = strings.ToLower(name), strings.ToLower(relative)
	if name == query {
		return 10000, true
	}
	if strings.HasPrefix(name, query) {
		return 8000 - int64(len(name)), true
	}
	if index := strings.Index(name, query); index >= 0 {
		return 6000 - int64(index+len(name)), true
	}
	if index := strings.Index(relative, query); index >= 0 {
		return 4000 - int64(index+len(relative)), true
	}
	wanted := []rune(query)
	index, gaps := 0, int64(0)
	for _, character := range relative {
		if character == wanted[index] {
			index++
			if index == len(wanted) {
				return 2000 - gaps - int64(len(relative)), true
			}
		} else {
			gaps++
		}
	}
	return 0, false
}

func searchPlainFolder(ctx context.Context, root string, showHidden, includeIgnored bool, results *workspaceSearchCollector) error {
	return filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(root, current)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		relative = filepath.ToSlash(relative)
		if skipSearchPath(relative, showHidden) || entry.IsDir() && !includeIgnored && (entry.Name() == "node_modules" || entry.Name() == "target") {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		kind := "file"
		if entry.IsDir() {
			kind = "directory"
		} else if entry.Type()&os.ModeSymlink != 0 {
			kind = "symlink"
		} else if !entry.Type().IsRegular() {
			return nil
		}
		results.consider(relative, kind)
		return nil
	})
}

func searchGitWorkspace(ctx context.Context, root string, showHidden, includeIgnored bool, results *workspaceSearchCollector) error {
	seenDirectories := make(map[string]struct{})
	seenOrder := make([]string, 0, workspaceSearchDirectoryCache)
	nextEviction := 0
	addDirectory := func(relative string) {
		for relative != "." && relative != "" && relative != "/" {
			if _, exists := seenDirectories[relative]; exists {
				return
			}
			if len(seenOrder) == workspaceSearchDirectoryCache {
				delete(seenDirectories, seenOrder[nextEviction])
				seenOrder[nextEviction] = relative
				nextEviction = (nextEviction + 1) % workspaceSearchDirectoryCache
			} else {
				seenOrder = append(seenOrder, relative)
			}
			seenDirectories[relative] = struct{}{}
			if !skipSearchPath(relative, showHidden) {
				results.consider(relative, "directory")
			}
			relative = path.Dir(relative)
		}
	}
	filter := []string{"--cached", "--others"}
	if !includeIgnored {
		filter = append(filter, "--exclude-standard")
	}
	if err := eachGitSearchPath(ctx, root, append(append([]string{}, filter...), "-z"), func(relative string) error {
		if skipSearchPath(relative, showHidden) || !safeSearchRelative(relative) {
			return nil
		}
		info, err := os.Lstat(filepath.Join(root, filepath.FromSlash(relative)))
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		kind := "file"
		if info.IsDir() {
			kind = "directory"
		} else if info.Mode()&os.ModeSymlink != 0 {
			kind = "symlink"
		} else if !info.Mode().IsRegular() {
			return nil
		}
		addDirectory(path.Dir(relative))
		results.consider(relative, kind)
		return nil
	}); err != nil {
		return err
	}
	directories := []string{"--others", "--directory"}
	if !includeIgnored {
		directories = append(directories, "--exclude-standard")
	}
	return eachGitSearchPath(ctx, root, append(directories, "-z"), func(relative string) error {
		relative = strings.TrimSuffix(relative, "/")
		if !safeSearchRelative(relative) || skipSearchPath(relative, showHidden) {
			return nil
		}
		addDirectory(relative)
		return nil
	})
}

func skipSearchPath(relative string, showHidden bool) bool {
	for _, component := range strings.Split(relative, "/") {
		if component == ".git" || strings.HasPrefix(component, ".openade-edit-") || !showHidden && strings.HasPrefix(component, ".") {
			return true
		}
	}
	return false
}

func safeSearchRelative(relative string) bool {
	clean := path.Clean(relative)
	return relative != "" && clean == relative && !strings.HasPrefix(relative, "/") && relative != ".." && !strings.HasPrefix(relative, "../")
}

func eachGitSearchPath(ctx context.Context, root string, args []string, visit func(string) error) error {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", root, "ls-files"}, args...)...)
	stderr := &boundedGitOutput{limit: 64 * 1024}
	cmd.Stderr = stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	finished := false
	defer func() {
		if !finished {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	reader := bufio.NewReaderSize(stdout, 64*1024)
	for {
		value, readErr := reader.ReadString(0)
		if readErr == nil {
			if err := visit(strings.TrimSuffix(value, "\x00")); err != nil {
				return err
			}
			continue
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return readErr
	}
	err = cmd.Wait()
	finished = true
	if err := ctx.Err(); err != nil {
		return err
	}
	if err != nil {
		return fmt.Errorf("git file search: %s", strings.TrimSpace(stderr.String()))
	}
	return nil
}
