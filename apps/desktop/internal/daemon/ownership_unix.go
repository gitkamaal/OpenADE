//go:build !windows

package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func acquireProfile(dataDir string) (func(), error) {
	file, err := os.OpenFile(filepath.Join(dataDir, "engine.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, fmt.Errorf("another engine owns this profile: %w", err)
	}
	return func() { _ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN); _ = file.Close() }, nil
}
