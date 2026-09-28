package daemon

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Session struct {
	queueMessageID       string
	autoTitle            bool
	forkContext          string
	forkContextSessionID string
	forkBootstrap        bool
	Model                string     `json:"model"`
	Instructions         string     `json:"instructions"`
	ProviderSessionID    string     `json:"provider_session_id"`
	ServiceTier          string     `json:"service_tier"`
	Effort               string     `json:"effort"`
	CurrentTurnID        string     `json:"current_turn_id"`
	Generation           int64      `json:"generation"`
	ID                   string     `json:"id"`
	ParentSessionID      string     `json:"parent_session_id,omitempty"`
	ForkSourceID         string     `json:"fork_source_id,omitempty"`
	Title                string     `json:"title"`
	Prompt               string     `json:"prompt"`
	Agent                string     `json:"agent"`
	Mode                 string     `json:"mode"`
	RepoRoot             string     `json:"repo_root"`
	WorktreePath         string     `json:"worktree_path"`
	Branch               string     `json:"branch"`
	BaseBranch           string     `json:"base_branch"`
	TicketKey            string     `json:"ticket_key,omitempty"`
	TicketURL            string     `json:"ticket_url,omitempty"`
	Status               string     `json:"status"`
	Archived             bool       `json:"archived"`
	PID                  int        `json:"pid,omitempty"`
	ExitCode             *int       `json:"exit_code,omitempty"`
	PRURL                string     `json:"pr_url,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
	FinishedAt           *time.Time `json:"finished_at,omitempty"`
}

type TerminalSession struct {
	ID         string     `json:"id"`
	SessionID  string     `json:"session_id"`
	Title      string     `json:"title"`
	Cwd        string     `json:"cwd"`
	Status     string     `json:"status"`
	PID        int        `json:"pid,omitempty"`
	ExitCode   *int       `json:"exit_code,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

type QueuedMessage struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	Text      string    `json:"text"`
	Status    string    `json:"status"`
	Priority  int       `json:"priority"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Store struct {
	db *sql.DB
}
type CleanupWarning struct{ Err error }

func (w *CleanupWarning) Error() string {
	return "metadata was removed but transcript cleanup failed: " + w.Err.Error()
}

func NewStore(dataDir string) (*Store, error) {
	dbPath := filepath.Join(dataDir, "openade.sqlite3")
	db, err := sql.Open("sqlite3", dbPath+"?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS registered_projects (path TEXT PRIMARY KEY,display_name TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS removed_projects (path TEXT PRIMARY KEY,removed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS project_catalog (path TEXT PRIMARY KEY,seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS title_settings (id INTEGER PRIMARY KEY CHECK(id=1),harness TEXT NOT NULL DEFAULT '',model TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL,
  repo_root TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL DEFAULT 'main',
  ticket_key TEXT NOT NULL DEFAULT '',
  ticket_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
	archived INTEGER NOT NULL DEFAULT 0,
  pid INTEGER NOT NULL DEFAULT 0,
  exit_code INTEGER,
  pr_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS provider_context(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,state TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_repo_idx ON sessions(repo_root, updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_ticket_idx ON sessions(ticket_key) WHERE ticket_key <> '';
CREATE TABLE IF NOT EXISTS terminals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  pid INTEGER NOT NULL DEFAULT 0,
  exit_code INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS terminals_session_idx ON terminals(session_id, created_at);
CREATE TABLE IF NOT EXISTS message_queue (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_queue_session_idx ON message_queue(session_id, status, priority DESC, created_at);
`)
	if err != nil {
		return fmt.Errorf("migrate sqlite: %w", err)
	}
	if _, alterErr := s.db.Exec(`ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'`); alterErr != nil && !strings.Contains(alterErr.Error(), "duplicate column") {
		return fmt.Errorf("add session mode: %w", alterErr)
	}
	if _, alterErr := s.db.Exec(`ALTER TABLE registered_projects ADD COLUMN display_name TEXT NOT NULL DEFAULT ''`); alterErr != nil && !strings.Contains(alterErr.Error(), "duplicate column") {
		return fmt.Errorf("add project display name: %w", alterErr)
	}
	if _, alterErr := s.db.Exec(`ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`); alterErr != nil && !strings.Contains(alterErr.Error(), "duplicate column") {
		return fmt.Errorf("add session archived state: %w", alterErr)
	}
	// Existing chats were deliberately named under the old behavior. Only new
	// Home chats marked pending may be replaced by automatic naming.
	if _, alterErr := s.db.Exec(`ALTER TABLE sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'manual'`); alterErr != nil && !strings.Contains(alterErr.Error(), "duplicate column") {
		return fmt.Errorf("add session title source: %w", alterErr)
	}
	for _, column := range []struct{ name, sql string }{
		{"parent_session_id", `ALTER TABLE sessions ADD COLUMN parent_session_id TEXT NOT NULL DEFAULT ''`},
		{"fork_source_id", `ALTER TABLE sessions ADD COLUMN fork_source_id TEXT NOT NULL DEFAULT ''`},
		{"fork_context", `ALTER TABLE sessions ADD COLUMN fork_context TEXT NOT NULL DEFAULT ''`},
		{"fork_context_session_id", `ALTER TABLE sessions ADD COLUMN fork_context_session_id TEXT NOT NULL DEFAULT ''`},
	} {
		if _, alterErr := s.db.Exec(column.sql); alterErr != nil && !strings.Contains(alterErr.Error(), "duplicate column") {
			return fmt.Errorf("add session %s: %w", column.name, alterErr)
		}
	}
	if _, err := s.db.Exec(`UPDATE message_queue SET status='uncertain' WHERE status IN ('steering','provider-starting')`); err != nil {
		return err
	}
	s.recoverProcesses()
	if err := s.migrateActivity(); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM message_queue WHERE status='dispatching' AND id IN (SELECT id FROM messages WHERE turn_id<>'')`); err != nil {
		return err
	}
	if _, resetErr := s.db.Exec(`UPDATE message_queue SET status='queued', updated_at=? WHERE status='dispatching'`, encodeTime(time.Now().UTC())); resetErr != nil {
		return resetErr
	}
	_, err = s.db.Exec(`UPDATE sessions SET status = 'interrupted', pid = 0,
updated_at = ? WHERE status IN ('starting', 'running', 'waiting')`, time.Now().UTC().Format(time.RFC3339Nano))
	if err == nil {
		_, err = s.db.Exec(`UPDATE terminals SET status = 'interrupted', pid = 0,
updated_at = ? WHERE status IN ('starting', 'running')`, time.Now().UTC().Format(time.RFC3339Nano))
	}
	return err
}

func (s *Store) EnqueueMessage(message QueuedMessage) error {
	if len(message.Text) > 256*1024 {
		return fmt.Errorf("message exceeds 256 KiB")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM message_queue WHERE session_id=?`, message.SessionID).Scan(&count); err != nil {
		return err
	}
	if count >= 100 {
		return fmt.Errorf("queue contains 100 messages")
	}
	_, err = tx.Exec(`INSERT INTO message_queue(id,session_id,text,status,priority,created_at,updated_at)
VALUES(?,?,?,?,?,?,?)`, message.ID, message.SessionID, message.Text, message.Status, message.Priority,
		encodeTime(message.CreatedAt), encodeTime(message.UpdatedAt))
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ListQueuedMessages(sessionID string) ([]QueuedMessage, error) {
	rows, err := s.db.Query(`SELECT id,session_id,text,status,priority,created_at,updated_at
FROM message_queue WHERE session_id=? ORDER BY CASE status WHEN 'dispatching' THEN 0 ELSE 1 END, priority DESC, created_at`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []QueuedMessage{}
	for rows.Next() {
		message, err := scanQueuedMessage(rows)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

func (s *Store) EditQueuedMessage(sessionID, messageID, text string) error {
	if len(text) > 256*1024 {
		return fmt.Errorf("message exceeds 256 KiB")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE message_queue SET text=?,updated_at=? WHERE id=? AND session_id=? AND status='queued'`, text, encodeTime(time.Now().UTC()), messageID, sessionID)
	if err != nil {
		return err
	}
	if err = requireAffected(result, "queued message"); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE messages SET text=? WHERE id=? AND session_id=? AND turn_id=''`, text, messageID, sessionID); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) PromoteQueuedMessage(sessionID, messageID string) error {
	result, err := s.db.Exec(`UPDATE message_queue SET priority=(SELECT COALESCE(MAX(priority),0)+1 FROM message_queue WHERE session_id=?), updated_at=?
WHERE id=? AND session_id=? AND status='queued'`, sessionID, encodeTime(time.Now().UTC()), messageID, sessionID)
	if err != nil {
		return err
	}
	return requireAffected(result, "queued message")
}

func (s *Store) DeleteQueuedMessage(sessionID, messageID string) error {
	result, err := s.db.Exec(`DELETE FROM message_queue WHERE id=? AND session_id=? AND status IN ('queued','uncertain')`, messageID, sessionID)
	if err != nil {
		return err
	}
	return requireAffected(result, "queued message")
}

func (s *Store) ClaimNextQueuedMessage(sessionID string) (QueuedMessage, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return QueuedMessage{}, err
	}
	defer tx.Rollback()
	message, err := scanQueuedMessage(tx.QueryRow(`SELECT id,session_id,text,status,priority,created_at,updated_at
FROM message_queue WHERE session_id=? AND status='queued' ORDER BY priority DESC, created_at LIMIT 1`, sessionID))
	if err != nil {
		return QueuedMessage{}, err
	}
	message.Status = "dispatching"
	message.UpdatedAt = time.Now().UTC()
	result, err := tx.Exec(`UPDATE message_queue SET status='dispatching', updated_at=? WHERE id=? AND status='queued'`, encodeTime(message.UpdatedAt), message.ID)
	if err != nil {
		return QueuedMessage{}, err
	}
	if err := requireAffected(result, "queued message"); err != nil {
		return QueuedMessage{}, err
	}
	if err := tx.Commit(); err != nil {
		return QueuedMessage{}, err
	}
	return message, nil
}

func (s *Store) ReleaseQueuedMessage(messageID string) error {
	_, err := s.db.Exec(`UPDATE message_queue SET status='queued', updated_at=? WHERE id=? AND status='dispatching'`, encodeTime(time.Now().UTC()), messageID)
	return err
}

// This is only for failures proved to occur before writing turn/start. Lost
// acknowledgements stay uncertain and must never use this recovery path.
func (s *Store) ReleaseUnsentCodexMessage(messageID string) error {
	if messageID == "" {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE message_queue SET status='queued',updated_at=? WHERE id=? AND status='provider-starting'`, encodeTime(time.Now().UTC()), messageID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed > 0 {
		// This attempt never reached the provider. Retaining its turn ID would
		// make a later pre-Begin retry look already sent during crash recovery.
		if _, err = tx.Exec(`UPDATE messages SET turn_id='',status='queued' WHERE id=?`, messageID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) CompleteQueuedMessage(messageID string) error {
	_, err := s.db.Exec(`DELETE FROM message_queue WHERE id=? AND status IN ('dispatching','steering','provider-starting')`, messageID)
	return err
}

func (s *Store) CreateSession(session Session) error {
	titleSource := "manual"
	if session.autoTitle {
		titleSource = "pending"
	}
	_, err := s.db.Exec(`INSERT INTO sessions
(id,title,prompt,agent,mode,repo_root,worktree_path,branch,base_branch,ticket_key,ticket_url,status,pid,created_at,updated_at,model,effort,service_tier,instructions,title_source,parent_session_id,fork_source_id,fork_context,fork_context_session_id)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, session.ID, session.Title, session.Prompt, session.Agent, session.Mode,
		session.RepoRoot, session.WorktreePath, session.Branch, session.BaseBranch, session.TicketKey,
		session.TicketURL, session.Status, session.PID, encodeTime(session.CreatedAt), encodeTime(session.UpdatedAt), session.Model, session.Effort, session.ServiceTier, session.Instructions, titleSource, session.ParentSessionID, session.ForkSourceID, session.forkContext, session.forkContextSessionID)
	return err
}

func (s *Store) markForkContextDelivered(id, providerSessionID string) error {
	if providerSessionID == "" {
		return nil
	}
	_, err := s.db.Exec(`UPDATE sessions SET fork_context_session_id=? WHERE id=? AND fork_source_id<>''`, providerSessionID, id)
	return err
}

func (s *Store) UpdateRuntime(id, status string, pid int, exitCode *int) error {
	return s.updateGeneration(id, 0, status, pid, exitCode)
}
func (s *Store) updateGeneration(id string, generation int64, status string, pid int, exitCode *int) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := encodeTime(time.Now().UTC())
	var finished any
	if status == "completed" || status == "failed" || status == "stopped" || status == "interrupted" {
		finished = now
	}
	result, err := tx.Exec(`UPDATE sessions SET status=?,pid=?,exit_code=?,updated_at=?,finished_at=? WHERE id=? AND (?=0 OR generation=?)`, status, pid, exitCode, now, finished, id, generation, generation)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return nil
	}
	_, err = tx.Exec(`UPDATE turns SET status=?,exit_code=?,finished_at=? WHERE id=(SELECT current_turn_id FROM sessions WHERE id=?) AND status IN ('starting','running','waiting')`, status, exitCode, finished, id)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UpdateMode(id, mode string) error {
	result, err := s.db.Exec(`UPDATE sessions SET mode=?, updated_at=? WHERE id=?`, mode, encodeTime(time.Now().UTC()), id)
	if err != nil {
		return err
	}
	return requireAffected(result, "session")
}

func (s *Store) CompletePR(operationID, sessionID, url string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := encodeTime(time.Now().UTC())
	if _, err = tx.Exec(`UPDATE operations SET status='completed',result=?,updated_at=? WHERE id=?`, url, now, operationID); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE sessions SET pr_url=?,updated_at=? WHERE id=?`, url, now, sessionID); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) SetPR(id, url string) error {
	_, err := s.db.Exec(`UPDATE sessions SET pr_url=?, updated_at=? WHERE id=?`, url, encodeTime(time.Now().UTC()), id)
	return err
}

func (s *Store) ListSessions() ([]Session, error) {
	rows, err := s.db.Query(`SELECT id,title,prompt,agent,mode,repo_root,worktree_path,branch,base_branch,
ticket_key,ticket_url,status,pid,exit_code,pr_url,created_at,updated_at,finished_at,current_turn_id,generation,model,effort,service_tier,instructions,provider_session_id,archived,parent_session_id,fork_source_id,'' AS fork_context,'' AS fork_context_session_id
FROM sessions ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var sessions []Session
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func (s *Store) GetSession(id string) (Session, error) {
	row := s.db.QueryRow(`SELECT id,title,prompt,agent,mode,repo_root,worktree_path,branch,base_branch,
ticket_key,ticket_url,status,pid,exit_code,pr_url,created_at,updated_at,finished_at,current_turn_id,generation,model,effort,service_tier,instructions,provider_session_id,archived,parent_session_id,fork_source_id,fork_context,fork_context_session_id
FROM sessions WHERE id=?`, id)
	return scanSession(row)
}

func (s *Store) SetSessionArchived(id string, archived bool) error {
	result, err := s.db.Exec(`UPDATE sessions SET archived=?,updated_at=? WHERE id=?`, archived, encodeTime(time.Now().UTC()), id)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected != 1 {
		return sql.ErrNoRows
	}
	return nil
}

type Project struct {
	Path        string `json:"path"`
	DisplayName string `json:"display_name,omitempty"`
}

func (s *Store) ListProjectMetadata() ([]Project, error) {
	rows, err := s.db.Query(`SELECT candidates.path,COALESCE(registered_projects.display_name,''),MAX(candidates.updated_at)
FROM (SELECT repo_root AS path,updated_at FROM sessions UNION ALL SELECT path,created_at AS updated_at FROM registered_projects) candidates
LEFT JOIN removed_projects ON removed_projects.path=candidates.path
LEFT JOIN registered_projects ON registered_projects.path=candidates.path
WHERE candidates.path<>'' AND removed_projects.path IS NULL
GROUP BY candidates.path ORDER BY MAX(candidates.updated_at) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []Project{}
	for rows.Next() {
		var project Project
		var ignored string
		if err := rows.Scan(&project.Path, &project.DisplayName, &ignored); err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (s *Store) ListProjects() ([]string, error) {
	metadata, err := s.ListProjectMetadata()
	if err != nil {
		return nil, err
	}
	projects := make([]string, 0, len(metadata))
	for _, project := range metadata {
		projects = append(projects, project.Path)
	}
	return projects, nil
}

func (s *Store) RenameProject(path, displayName string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`INSERT INTO registered_projects(path,display_name) VALUES(?,?) ON CONFLICT(path) DO UPDATE SET display_name=excluded.display_name`, path, displayName); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO activity(kind,entity_id,session_id,data) VALUES('catalog',?,'','{}')`, path); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ProjectRemoved(path string) (bool, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM removed_projects WHERE path=?`, path).Scan(&count)
	return count > 0, err
}
func (s *Store) ProjectKnown(path string) (bool, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM (SELECT path FROM registered_projects WHERE path=? UNION ALL SELECT repo_root FROM sessions WHERE repo_root=? UNION ALL SELECT path FROM project_catalog WHERE path=?)`, path, path, path).Scan(&count)
	return count > 0, err
}
func (s *Store) RecordProjectCatalog(paths []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, path := range paths {
		if _, err = tx.Exec(`INSERT INTO project_catalog(path) VALUES(?) ON CONFLICT(path) DO UPDATE SET seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`, path); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) FilterRemovedProjects(paths []string) ([]string, error) {
	visible := make([]string, 0, len(paths))
	for _, path := range paths {
		removed, err := s.ProjectRemoved(path)
		if err != nil {
			return nil, err
		}
		if !removed {
			visible = append(visible, path)
		}
	}
	return visible, nil
}

func (s *Store) ProjectSessions(path string) ([]string, error) {
	rows, err := s.db.Query(`SELECT id FROM sessions WHERE repo_root=? ORDER BY id`, path)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) RemoveProject(path string, expectedIDs []string, dataDir string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT id FROM sessions WHERE repo_root=? ORDER BY id`, path)
	if err != nil {
		return err
	}
	actual := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		actual = append(actual, id)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(actual) != len(expectedIDs) {
		return fmt.Errorf("project changed; review the current %d chats before removing", len(actual))
	}
	for i := range actual {
		if actual[i] != expectedIDs[i] {
			return fmt.Errorf("project changed; review the current chats before removing")
		}
	}
	terminalIDs := []string{}
	for _, id := range actual {
		rows, queryErr := tx.Query(`SELECT id FROM terminals WHERE session_id=?`, id)
		if queryErr != nil {
			return queryErr
		}
		for rows.Next() {
			var terminalID string
			if queryErr = rows.Scan(&terminalID); queryErr != nil {
				rows.Close()
				return queryErr
			}
			terminalIDs = append(terminalIDs, terminalID)
		}
		if queryErr = rows.Err(); queryErr != nil {
			rows.Close()
			return queryErr
		}
		rows.Close()
		for _, table := range []string{"operations", "messages", "turns", "message_queue", "provider_context"} {
			if _, queryErr = tx.Exec(`DELETE FROM `+table+` WHERE session_id=?`, id); queryErr != nil {
				return queryErr
			}
		}
	}
	if _, err = tx.Exec(`DELETE FROM sessions WHERE repo_root=?`, path); err != nil {
		return err
	}
	for _, id := range actual {
		if _, err = tx.Exec(`DELETE FROM activity WHERE session_id=?`, id); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`DELETE FROM registered_projects WHERE path=?`, path); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO removed_projects(path) VALUES(?) ON CONFLICT(path) DO UPDATE SET removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`, path); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO activity(kind,entity_id,session_id,data) VALUES('catalog',?,'','{}')`, path); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	cleanup := []error{}
	for _, id := range actual {
		if removeErr := os.Remove(filepath.Join(dataDir, "transcripts", id+".log")); removeErr != nil && !os.IsNotExist(removeErr) {
			cleanup = append(cleanup, removeErr)
		}
	}
	for _, id := range terminalIDs {
		if removeErr := os.Remove(filepath.Join(dataDir, "terminal-transcripts", id+".log")); removeErr != nil && !os.IsNotExist(removeErr) {
			cleanup = append(cleanup, removeErr)
		}
	}
	if len(cleanup) > 0 {
		return &CleanupWarning{Err: errors.Join(cleanup...)}
	}
	return nil
}

func (s *Store) DeleteSession(id string, dataDir string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT id FROM terminals WHERE session_id=?`, id)
	if err != nil {
		return err
	}
	terminalIDs := []string{}
	for rows.Next() {
		var terminalID string
		if err = rows.Scan(&terminalID); err != nil {
			rows.Close()
			return err
		}
		terminalIDs = append(terminalIDs, terminalID)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, table := range []string{"operations", "messages", "turns", "message_queue", "provider_context"} {
		if _, err = tx.Exec(`DELETE FROM `+table+` WHERE session_id=?`, id); err != nil {
			return err
		}
	}
	// A surviving child must remain reachable if its parent is deleted.
	if _, err = tx.Exec(`UPDATE sessions SET parent_session_id='',updated_at=? WHERE parent_session_id=?`, encodeTime(time.Now().UTC()), id); err != nil {
		return err
	}
	result, err := tx.Exec(`DELETE FROM sessions WHERE id=?`, id)
	if err != nil {
		return err
	}
	if err = requireAffected(result, "session"); err != nil {
		return err
	}
	if _, err = tx.Exec(`DELETE FROM activity WHERE session_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO activity(kind,entity_id,session_id,data) VALUES('catalog',?,'','{}')`, id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	cleanup := []error{}
	if removeErr := os.Remove(filepath.Join(dataDir, "transcripts", id+".log")); removeErr != nil && !os.IsNotExist(removeErr) {
		cleanup = append(cleanup, removeErr)
	}
	for _, terminalID := range terminalIDs {
		if removeErr := os.Remove(filepath.Join(dataDir, "terminal-transcripts", terminalID+".log")); removeErr != nil && !os.IsNotExist(removeErr) {
			cleanup = append(cleanup, removeErr)
		}
	}
	if len(cleanup) > 0 {
		return &CleanupWarning{Err: errors.Join(cleanup...)}
	}
	return nil
}

func (s *Store) CreateTerminal(terminal TerminalSession) error {
	_, err := s.db.Exec(`INSERT INTO terminals
(id,session_id,title,cwd,status,pid,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
		terminal.ID, terminal.SessionID, terminal.Title, terminal.Cwd, terminal.Status,
		terminal.PID, encodeTime(terminal.CreatedAt), encodeTime(terminal.UpdatedAt))
	return err
}

func (s *Store) UpdateTerminalRuntime(id, status string, pid int, exitCode *int) error {
	now := time.Now().UTC()
	var finished any
	if status == "completed" || status == "failed" || status == "stopped" {
		finished = encodeTime(now)
	}
	_, err := s.db.Exec(`UPDATE terminals SET status=?, pid=?, exit_code=?, updated_at=?,
finished_at=COALESCE(?, finished_at) WHERE id=?`, status, pid, exitCode, encodeTime(now), finished, id)
	return err
}

func (s *Store) ListTerminals(sessionID string) ([]TerminalSession, error) {
	rows, err := s.db.Query(`SELECT id,session_id,title,cwd,status,pid,exit_code,created_at,updated_at,finished_at
FROM terminals WHERE session_id=? ORDER BY created_at`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	terminals := []TerminalSession{}
	for rows.Next() {
		terminal, err := scanTerminal(rows)
		if err != nil {
			return nil, err
		}
		terminals = append(terminals, terminal)
	}
	return terminals, rows.Err()
}

func (s *Store) GetTerminal(id string) (TerminalSession, error) {
	row := s.db.QueryRow(`SELECT id,session_id,title,cwd,status,pid,exit_code,created_at,updated_at,finished_at
FROM terminals WHERE id=?`, id)
	return scanTerminal(row)
}

type scanner interface{ Scan(...any) error }

func scanSession(row scanner) (Session, error) {
	var session Session
	var created, updated string
	var finished sql.NullString
	var exitCode sql.NullInt64
	err := row.Scan(&session.ID, &session.Title, &session.Prompt, &session.Agent, &session.Mode, &session.RepoRoot,
		&session.WorktreePath, &session.Branch, &session.BaseBranch, &session.TicketKey, &session.TicketURL,
		&session.Status, &session.PID, &exitCode, &session.PRURL, &created, &updated, &finished, &session.CurrentTurnID, &session.Generation, &session.Model, &session.Effort, &session.ServiceTier, &session.Instructions, &session.ProviderSessionID, &session.Archived, &session.ParentSessionID, &session.ForkSourceID, &session.forkContext, &session.forkContextSessionID)
	if err != nil {
		return session, err
	}
	session.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	session.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	if finished.Valid {
		t, _ := time.Parse(time.RFC3339Nano, finished.String)
		session.FinishedAt = &t
	}
	if exitCode.Valid {
		code := int(exitCode.Int64)
		session.ExitCode = &code
	}
	return session, nil
}

func scanTerminal(row scanner) (TerminalSession, error) {
	var terminal TerminalSession
	var created, updated string
	var finished sql.NullString
	var exitCode sql.NullInt64
	err := row.Scan(&terminal.ID, &terminal.SessionID, &terminal.Title, &terminal.Cwd, &terminal.Status,
		&terminal.PID, &exitCode, &created, &updated, &finished)
	if err != nil {
		return terminal, err
	}
	terminal.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	terminal.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	if finished.Valid {
		t, _ := time.Parse(time.RFC3339Nano, finished.String)
		terminal.FinishedAt = &t
	}
	if exitCode.Valid {
		code := int(exitCode.Int64)
		terminal.ExitCode = &code
	}
	return terminal, nil
}

func scanQueuedMessage(row scanner) (QueuedMessage, error) {
	var message QueuedMessage
	var created, updated string
	err := row.Scan(&message.ID, &message.SessionID, &message.Text, &message.Status, &message.Priority, &created, &updated)
	if err != nil {
		return message, err
	}
	message.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	message.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return message, nil
}

func requireAffected(result sql.Result, label string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("%s was not found", label)
	}
	return nil
}

func encodeTime(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func IsNotFound(err error) bool { return errors.Is(err, sql.ErrNoRows) }
