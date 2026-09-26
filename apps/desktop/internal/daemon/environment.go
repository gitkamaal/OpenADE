package daemon

import (
	"os"
	"path/filepath"
	"strings"
)

// Finder-launched apps inherit a minimal PATH. Keep caller overrides first,
// then supply the usual locations for provider CLIs and their runtimes.
func processEnvironment(extra ...string) []string {
	env := os.Environ()
	paths := filepath.SplitList(os.Getenv("PATH"))
	home, _ := os.UserHomeDir()
	for _, candidate := range []string{"/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", filepath.Join(home, ".local/bin"), filepath.Join(home, ".grok/bin"), filepath.Join(home, ".cargo/bin"), filepath.Join(home, ".bun/bin"), filepath.Join(home, ".local/share/mise/shims"), filepath.Join(home, ".volta/bin")} {
		found := false
		for _, existing := range paths {
			if existing == candidate {
				found = true
				break
			}
		}
		if !found {
			paths = append(paths, candidate)
		}
	}
	filtered := make([]string, 0, len(env)+len(extra)+1)
	for _, value := range env {
		if !strings.HasPrefix(value, "PATH=") {
			filtered = append(filtered, value)
		}
	}
	return append(append(filtered, "PATH="+strings.Join(paths, string(os.PathListSeparator))), extra...)
}
