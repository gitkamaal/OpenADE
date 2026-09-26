//go:build !windows

package daemon

import (
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func ownedProcess(pid int, id string) bool {
	if pid <= 0 {
		return false
	}
	out, err := exec.Command("ps", "eww", "-p", strconv.Itoa(pid), "-o", "command=").Output()
	return err == nil && strings.Contains(string(out), "OPENADE_SESSION_ID="+id)
}
func (s *Store) recoverProcesses() {
	rows, err := s.db.Query(`SELECT pid,id FROM sessions WHERE pid>0 AND status IN ('starting','running','waiting')`)
	if err != nil {
		return
	}
	type process struct {
		pid int
		id  string
	}
	old := []process{}
	for rows.Next() {
		var item process
		if rows.Scan(&item.pid, &item.id) == nil {
			old = append(old, item)
		}
	}
	rows.Close()
	for _, item := range old {
		if ownedProcess(item.pid, item.id) {
			_ = syscall.Kill(-item.pid, syscall.SIGTERM)
		}
	}
	if len(old) == 0 {
		return
	}
	time.Sleep(100 * time.Millisecond)
	for _, item := range old {
		if ownedProcess(item.pid, item.id) {
			_ = syscall.Kill(-item.pid, syscall.SIGKILL)
		}
	}
}
