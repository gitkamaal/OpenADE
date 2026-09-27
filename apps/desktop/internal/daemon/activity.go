package daemon

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Activity struct {
	Sequence  int64           `json:"sequence"`
	Kind      string          `json:"kind"`
	EntityID  string          `json:"entity_id"`
	SessionID string          `json:"session_id"`
	Data      json.RawMessage `json:"data"`
	CreatedAt string          `json:"created_at"`
}

func (s *Store) migrateActivity() error {
	for _, statement := range []string{
		`ALTER TABLE sessions ADD COLUMN current_turn_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN generation INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE sessions ADD COLUMN model TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN effort TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN service_tier TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN instructions TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN provider_session_id TEXT NOT NULL DEFAULT ''`,
	} {
		if _, err := s.db.Exec(statement); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return err
		}
	}
	_, err := s.db.Exec(`
 CREATE TABLE IF NOT EXISTS activity(sequence INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,entity_id TEXT NOT NULL,session_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),generation INTEGER NOT NULL,prompt TEXT NOT NULL,queue_message_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,exit_code INTEGER,started_at TEXT NOT NULL,finished_at TEXT);
 CREATE INDEX IF NOT EXISTS turns_session_idx ON turns(session_id,generation);
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),turn_id TEXT NOT NULL DEFAULT '',text TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),kind TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS project_activity_insert AFTER INSERT ON registered_projects BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('project',NEW.path,'',json_object('path',NEW.path)); END;
 CREATE TRIGGER IF NOT EXISTS sessions_activity_insert AFTER INSERT ON sessions BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('session',NEW.id,NEW.id,json_object('id',NEW.id,'status',NEW.status,'generation',NEW.generation,'turn_id',NEW.current_turn_id)); END;
 CREATE TRIGGER IF NOT EXISTS sessions_activity_update AFTER UPDATE ON sessions BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('session',NEW.id,NEW.id,json_object('id',NEW.id,'status',NEW.status,'generation',NEW.generation,'turn_id',NEW.current_turn_id)); END;
 CREATE TRIGGER IF NOT EXISTS queue_message_insert AFTER INSERT ON message_queue BEGIN INSERT INTO messages(id,session_id,text,status,created_at) VALUES(NEW.id,NEW.session_id,NEW.text,NEW.status,NEW.created_at); END;
 CREATE TRIGGER IF NOT EXISTS queue_message_update AFTER UPDATE ON message_queue BEGIN UPDATE messages SET status=NEW.status WHERE id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS queue_message_delete AFTER DELETE ON message_queue BEGIN UPDATE messages SET status='removed' WHERE id=OLD.id AND turn_id=''; END;
 CREATE TRIGGER IF NOT EXISTS operation_activity_insert AFTER INSERT ON operations BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('operation',NEW.id,NEW.session_id,json_object('id',NEW.id,'kind',NEW.kind,'status',NEW.status)); END;
 CREATE TRIGGER IF NOT EXISTS queue_activity_insert AFTER INSERT ON message_queue BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('queue',NEW.id,NEW.session_id,json_object('id',NEW.id,'status',NEW.status)); END;
 CREATE TRIGGER IF NOT EXISTS queue_activity_update AFTER UPDATE ON message_queue BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('queue',NEW.id,NEW.session_id,json_object('id',NEW.id,'status',NEW.status)); END;
 CREATE TRIGGER IF NOT EXISTS queue_activity_delete AFTER DELETE ON message_queue BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('queue',OLD.id,OLD.session_id,json_object('id',OLD.id,'status','removed')); END;
 CREATE TRIGGER IF NOT EXISTS terminal_activity_insert AFTER INSERT ON terminals BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('terminal',NEW.id,NEW.session_id,json_object('id',NEW.id,'status',NEW.status)); END;
 CREATE TRIGGER IF NOT EXISTS terminal_activity_update AFTER UPDATE ON terminals BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('terminal',NEW.id,NEW.session_id,json_object('id',NEW.id,'status',NEW.status)); END;
 CREATE TRIGGER IF NOT EXISTS turn_activity_update AFTER UPDATE ON turns BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('turn',NEW.id,NEW.session_id,json_object('id',NEW.id,'status',NEW.status,'generation',NEW.generation)); END;
 CREATE TRIGGER IF NOT EXISTS operation_activity_update AFTER UPDATE ON operations BEGIN INSERT INTO activity(kind,entity_id,session_id,data) VALUES('operation',NEW.id,NEW.session_id,json_object('id',NEW.id,'status',NEW.status)); END;
 UPDATE turns SET status='interrupted',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status IN ('starting','running');
 UPDATE operations SET status='interrupted',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='running';
 `)
	if err == nil {
		_, err = s.db.Exec(`ALTER TABLE turns ADD COLUMN start_tree TEXT NOT NULL DEFAULT ''`)
		if err != nil && strings.Contains(err.Error(), "duplicate column") {
			err = nil
		}
	}
	return err
}

func (s *Store) BeginTurn(sessionID, prompt, messageID, startTree string) (string, int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", 0, err
	}
	defer tx.Rollback()
	var generation int64
	if err = tx.QueryRow(`SELECT generation FROM sessions WHERE id=?`, sessionID).Scan(&generation); err != nil {
		return "", 0, err
	}
	generation++
	id := uuid.NewString()
	now := encodeTime(time.Now().UTC())
	_, err = tx.Exec(`INSERT INTO turns(id,session_id,generation,prompt,queue_message_id,status,started_at,start_tree) VALUES(?,?,?,?,?,'starting',?,?)`, id, sessionID, generation, prompt, messageID, now, startTree)
	if err != nil {
		return "", 0, err
	}
	if messageID == "" {
		messageID = uuid.NewString()
	}
	_, err = tx.Exec(`INSERT INTO messages(id,session_id,turn_id,text,status,created_at) VALUES(?,?,?,?,'sent',?) ON CONFLICT(id) DO UPDATE SET turn_id=excluded.turn_id,status='sent'`, messageID, sessionID, id, prompt, now)
	if err != nil {
		return "", 0, err
	}
	_, err = tx.Exec(`UPDATE sessions SET generation=?,current_turn_id=?,status='starting',finished_at=NULL,updated_at=? WHERE id=?`, generation, id, now, sessionID)
	if err != nil {
		return "", 0, err
	}
	return id, generation, tx.Commit()
}

const sessionColumns = `id,title,prompt,agent,mode,repo_root,worktree_path,branch,base_branch,ticket_key,ticket_url,status,pid,exit_code,pr_url,created_at,updated_at,finished_at,current_turn_id,generation,model,effort,service_tier,instructions`

func (s *Store) Snapshot(ctx context.Context) (map[string]any, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var sequence int64
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sequence),0) FROM activity`).Scan(&sequence); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT `+sessionColumns+` FROM sessions ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	sessions := []Session{}
	projects := []string{}
	seen := map[string]bool{}
	for rows.Next() {
		session, scanErr := scanSession(rows)
		if scanErr != nil {
			rows.Close()
			return nil, scanErr
		}
		sessions = append(sessions, session)
		if session.RepoRoot != "" && !seen[session.RepoRoot] {
			projects = append(projects, session.RepoRoot)
			seen[session.RepoRoot] = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	registered, err := tx.QueryContext(ctx, `SELECT path FROM registered_projects ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	for registered.Next() {
		var path string
		if err = registered.Scan(&path); err != nil {
			registered.Close()
			return nil, err
		}
		if path != "" && !seen[path] {
			projects = append(projects, path)
			seen[path] = true
		}
	}
	err = registered.Err()
	registered.Close()
	if err != nil {
		return nil, err
	}
	queueRows, err := tx.QueryContext(ctx, `SELECT id,session_id,text,status,priority,created_at,updated_at FROM message_queue ORDER BY priority DESC,created_at`)
	if err != nil {
		return nil, err
	}
	queues := map[string][]QueuedMessage{}
	for queueRows.Next() {
		message, scanErr := scanQueuedMessage(queueRows)
		if scanErr != nil {
			queueRows.Close()
			return nil, scanErr
		}
		queues[message.SessionID] = append(queues[message.SessionID], message)
	}
	err = queueRows.Err()
	queueRows.Close()
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"sequence": sequence, "sessions": sessions, "projects": projects, "queues": queues}, nil
}

func (s *Store) Activities(ctx context.Context, after int64) ([]Activity, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT sequence,kind,entity_id,session_id,data,created_at FROM activity WHERE sequence>? ORDER BY sequence LIMIT 256`, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []Activity{}
	for rows.Next() {
		var event Activity
		var data string
		if err := rows.Scan(&event.Sequence, &event.Kind, &event.EntityID, &event.SessionID, &data, &event.CreatedAt); err != nil {
			return nil, err
		}
		event.Data = json.RawMessage(data)
		events = append(events, event)
	}
	return events, rows.Err()
}

func (d *Daemon) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	snapshot, err := d.store.Snapshot(r.Context())
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, snapshot)
}
func (d *Daemon) handleEvents(w http.ResponseWriter, r *http.Request) {
	after, err := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if err != nil || after < 0 {
		writeError(w, 400, fmt.Errorf("valid event cursor required"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, 500, fmt.Errorf("streaming unavailable"))
		return
	}
	controller := http.NewResponseController(w)
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		var latest int64
		if err := d.store.db.QueryRowContext(r.Context(), `SELECT COALESCE(MAX(sequence),0) FROM activity`).Scan(&latest); err != nil {
			return
		}
		if after > latest || latest-after > 4096 {
			_ = controller.SetWriteDeadline(time.Now().Add(3 * time.Second))
			fmt.Fprintf(w, "event: reset\ndata: {}\n\n")
			flusher.Flush()
			return
		}
		events, err := d.store.Activities(r.Context(), after)
		if err != nil {
			return
		}
		if len(events) > 0 {
			_ = controller.SetWriteDeadline(time.Now().Add(3 * time.Second))
			payload, _ := json.Marshal(events)
			if _, err = fmt.Fprintf(w, "id: %d\nevent: activity\ndata: %s\n\n", events[len(events)-1].Sequence, payload); err != nil {
				return
			}
			flusher.Flush()
			after = events[len(events)-1].Sequence
			if len(events) == 256 {
				continue
			}
		}
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		case <-heartbeat.C:
			_ = controller.SetWriteDeadline(time.Now().Add(3 * time.Second))
			if _, err = fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Store) BeginOperation(sessionID, kind string) (string, error) {
	id := uuid.NewString()
	now := encodeTime(time.Now().UTC())
	_, err := s.db.Exec(`INSERT INTO operations(id,session_id,kind,status,created_at,updated_at) VALUES(?,?,?,'running',?,?)`, id, sessionID, kind, now, now)
	return id, err
}
func (s *Store) FinishOperation(id, status, result string) error {
	_, err := s.db.Exec(`UPDATE operations SET status=?,result=?,updated_at=? WHERE id=?`, status, result, encodeTime(time.Now().UTC()), id)
	return err
}
func (d *Daemon) handleTurns(w http.ResponseWriter, r *http.Request) {
	rows, err := d.store.db.QueryContext(r.Context(), `SELECT id,generation,prompt,queue_message_id,status,exit_code,started_at,finished_at FROM turns WHERE session_id=? ORDER BY generation DESC LIMIT 200`, r.PathValue("id"))
	if err != nil {
		writeError(w, 500, err)
		return
	}
	defer rows.Close()
	turns := []map[string]any{}
	for rows.Next() {
		var id, prompt, messageID, status, start string
		var generation int64
		var code sql.NullInt64
		var finish sql.NullString
		if err := rows.Scan(&id, &generation, &prompt, &messageID, &status, &code, &start, &finish); err != nil {
			writeError(w, 500, err)
			return
		}
		var exitCode, finishedAt any
		if code.Valid {
			exitCode = code.Int64
		}
		if finish.Valid {
			finishedAt = finish.String
		}
		turns = append(turns, map[string]any{"id": id, "generation": generation, "prompt": prompt, "queue_message_id": messageID, "status": status, "exit_code": exitCode, "started_at": start, "finished_at": finishedAt})
	}
	writeJSON(w, 200, map[string]any{"turns": turns})
}
func (d *Daemon) handleCommit(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message string `json:"message"`
		Staged  bool   `json:"staged"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&body); err != nil || strings.TrimSpace(body.Message) == "" {
		writeError(w, 400, fmt.Errorf("commit message is required"))
		return
	}
	session, err := d.store.GetSession(r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	id, err := d.store.BeginOperation(session.ID, "commit")
	if err != nil {
		writeError(w, 500, err)
		return
	}
	if !body.Staged {
		_, err = gitOutput(r.Context(), session.WorktreePath, "add", "--all", "--", ".")
	}
	if err == nil {
		_, err = gitOutput(r.Context(), session.WorktreePath, "commit", "-m", strings.TrimSpace(body.Message))
	}
	if err != nil {
		_ = d.store.FinishOperation(id, "failed", "")
		writeError(w, 409, err)
		return
	}
	sha, err := gitOutput(r.Context(), session.WorktreePath, "rev-parse", "HEAD")
	if err != nil {
		_ = d.store.FinishOperation(id, "failed", "")
		writeError(w, 500, err)
		return
	}
	_ = d.store.FinishOperation(id, "completed", sha)
	writeJSON(w, 201, map[string]string{"sha": sha})
}
