package daemon

// Existing PTY process management is Unix-only; no unverified Windows PID killing.
func (s *Store) recoverProcesses() {}
