//go:build darwin

package daemon

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

func generatedSourceParts(root, source string) ([]string, error) {
	if !filepath.IsAbs(root) || !filepath.IsAbs(source) {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(source))
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	parts := strings.Split(relative, string(filepath.Separator))
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsRune(part, 0) {
			return nil, fmt.Errorf("generated image source is unavailable")
		}
	}
	return parts, nil
}

func openGeneratedAt(rootFD int, parts []string) (int, error) {
	current, err := unix.Dup(rootFD)
	if err != nil {
		return -1, err
	}
	for index, part := range parts {
		flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW | unix.O_NONBLOCK
		if index+1 < len(parts) {
			flags |= unix.O_DIRECTORY
		}
		next, openErr := unix.Openat(current, part, flags, 0)
		_ = unix.Close(current)
		if openErr != nil {
			return -1, openErr
		}
		current = next
	}
	return current, nil
}

func sameGeneratedStat(a, b unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Size == b.Size && a.Mtim == b.Mtim && a.Ctim == b.Ctim && a.Mode&unix.S_IFMT == unix.S_IFREG && b.Mode&unix.S_IFMT == unix.S_IFREG
}

// Pin every path component with openat/O_NOFOLLOW and re-open the name after
// copying. A symlink, path replacement, or same-size in-place write invalidates
// the import before any file can be published in the app profile.
func readGeneratedSource(root, source string) ([]byte, error) {
	parts, err := generatedSourceParts(root, source)
	if err != nil {
		return nil, err
	}
	rootFD, err := unix.Open(root, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	defer unix.Close(rootFD)
	fd, err := openGeneratedAt(rootFD, parts)
	if err != nil {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	file := os.NewFile(uintptr(fd), source)
	defer file.Close()
	var before, after, named unix.Stat_t
	if err = unix.Fstat(fd, &before); err != nil || before.Mode&unix.S_IFMT != unix.S_IFREG || before.Size <= 0 || before.Size > maxGeneratedImageBytes {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxGeneratedImageBytes+1))
	if err != nil || int64(len(data)) != before.Size {
		return nil, fmt.Errorf("generated image source changed while reading")
	}
	if err = unix.Fstat(fd, &after); err != nil || !sameGeneratedStat(before, after) {
		return nil, fmt.Errorf("generated image source changed while reading")
	}
	namedFD, err := openGeneratedAt(rootFD, parts)
	if err != nil {
		return nil, fmt.Errorf("generated image source changed while reading")
	}
	defer unix.Close(namedFD)
	if err = unix.Fstat(namedFD, &named); err != nil || !sameGeneratedStat(before, named) {
		return nil, fmt.Errorf("generated image source changed while reading")
	}
	return data, nil
}
