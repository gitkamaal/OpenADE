//go:build !darwin

package daemon

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func readGeneratedSource(rootPath, source string) ([]byte, error) {
	if !filepath.IsAbs(rootPath) || !filepath.IsAbs(source) {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	relative, err := filepath.Rel(filepath.Clean(rootPath), filepath.Clean(source))
	if err != nil || relative == "." || relative == ".." || filepath.IsAbs(relative) || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	defer root.Close()
	parts := strings.Split(relative, string(filepath.Separator))
	for index := range parts {
		info, statErr := root.Lstat(filepath.Join(parts[:index+1]...))
		if statErr != nil || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("generated image source is unavailable")
		}
	}
	file, err := root.Open(relative)
	if err != nil {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 || before.Size() > maxGeneratedImageBytes {
		return nil, fmt.Errorf("generated image source is unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxGeneratedImageBytes+1))
	after, afterErr := file.Stat()
	named, namedErr := root.Lstat(relative)
	if err != nil || afterErr != nil || namedErr != nil || len(data) != int(before.Size()) || !os.SameFile(before, after) || !os.SameFile(before, named) || after.Size() != before.Size() || after.ModTime() != before.ModTime() || named.ModTime() != before.ModTime() {
		return nil, fmt.Errorf("generated image source changed while reading")
	}
	return data, nil
}
