package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const maxForkTranscript = 16 * 1024 * 1024
const maxForkContext = 256 * 1024

// Fork creates a separate provider conversation in the source checkout. The
// copied transcript is a frozen, completed prefix; the source remains live and
// cannot receive child messages. No new Git worktree is created.
func (m *SessionManager) Fork(ctx context.Context, sourceID, parentID string, copyHistory bool) (Session, error) {
	m.surfaceMu.Lock()
	defer m.surfaceMu.Unlock()
	source, err := m.store.GetSession(sourceID)
	if err != nil {
		return Session{}, err
	}
	if source.Mode != "chat" || !providerCapabilities(source.Agent).NativeChat {
		return Session{}, fmt.Errorf("side chats require a completed chat conversation")
	}
	if parentID == "" {
		parentID = source.ID
	}
	if parentID != source.ID && parentID != source.ParentSessionID {
		return Session{}, fmt.Errorf("a side chat can only fork beside its source or parent")
	}
	if parentID != source.ID {
		parent, parentErr := m.store.GetSession(parentID)
		if parentErr != nil || parent.WorktreePath != source.WorktreePath || parent.RepoRoot != source.RepoRoot {
			return Session{}, fmt.Errorf("parent conversation is unavailable")
		}
	}
	if err := ctx.Err(); err != nil {
		return Session{}, err
	}
	var content forkTranscript
	if copyHistory {
		content, err = frozenForkTranscript(filepath.Join(m.dataDir, "transcripts", source.ID+".log"), source.Prompt, source.CreatedAt)
		if err != nil {
			return Session{}, err
		}
		marker, marshalErr := json.Marshal(map[string]string{"type": "openade.fork_source", "source_id": source.ID, "title": source.Title})
		if marshalErr != nil {
			return Session{}, marshalErr
		}
		content.prefix = append(content.prefix, marker...)
		content.prefix = append(content.prefix, '\n')
	}
	if err := ctx.Err(); err != nil {
		return Session{}, err
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	child := Session{
		ID: id, ParentSessionID: parentID,
		Title: "New side chat", Agent: source.Agent, Mode: "chat",
		RepoRoot: source.RepoRoot, WorktreePath: source.WorktreePath,
		Branch: source.Branch, BaseBranch: source.BaseBranch,
		Model: source.Model, Effort: source.Effort, ServiceTier: source.ServiceTier,
		Instructions: source.Instructions, Status: "completed", CreatedAt: now, UpdatedAt: now,
		autoTitle: true, forkContext: content.context,
	}
	if copyHistory {
		child.ForkSourceID = source.ID
	}
	dir := filepath.Join(m.dataDir, "transcripts")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Session{}, err
	}
	path := filepath.Join(dir, child.ID+".log")
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return Session{}, err
	}
	if _, err = file.Write(content.prefix); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return Session{}, err
	}
	if err = m.store.CreateSession(child); err != nil {
		_ = os.Remove(path)
		return Session{}, err
	}
	return m.store.GetSession(child.ID)
}

type forkTranscript struct {
	prefix  []byte
	context string
}

func frozenForkTranscript(path, initialPrompt string, initialCreatedAt time.Time) (forkTranscript, error) {
	file, err := os.Open(path)
	if err != nil {
		return forkTranscript{}, fmt.Errorf("conversation transcript is unavailable: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return forkTranscript{}, err
	}
	if info.Size() > maxForkTranscript {
		return forkTranscript{}, fmt.Errorf("conversation transcript is too large to fork safely")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxForkTranscript+1))
	if err != nil {
		return forkTranscript{}, err
	}
	if len(data) > maxForkTranscript {
		return forkTranscript{}, fmt.Errorf("conversation transcript is too large to fork safely")
	}
	type turn struct{ user, assistant, userAt, assistantAt string }
	turns := make([]turn, 0, 8)
	current := turn{user: strings.TrimSpace(initialPrompt), userAt: encodeTime(initialCreatedAt)}
	completedTurns := 0
	completedCurrent := false
	for _, raw := range bytes.SplitAfter(data, []byte{'\n'}) {
		var event map[string]any
		if json.Unmarshal(bytes.TrimSpace(raw), &event) != nil {
			continue
		}
		typeName, _ := event["type"].(string)
		switch typeName {
		case "openade.user_message":
			current = turn{user: strings.TrimSpace(stringField(event, "text")), userAt: stringField(event, "created_at")}
			completedCurrent = false
		case "openade.agent_message":
			current.assistant = strings.TrimSpace(stringField(event, "text"))
		case "openade.agent_delta":
			current.assistant += stringField(event, "text")
		case "item.completed":
			if item, ok := event["item"].(map[string]any); ok && item["type"] == "agent_message" {
				current.assistant = strings.TrimSpace(stringField(item, "text"))
			}
		case "assistant":
			if message, ok := event["message"].(map[string]any); ok {
				if parts, ok := message["content"].([]any); ok {
					for _, part := range parts {
						if block, ok := part.(map[string]any); ok && block["type"] == "text" {
							current.assistant += stringField(block, "text")
						}
					}
				}
			}
		case "result":
			if result := strings.TrimSpace(stringField(event, "result")); result != "" {
				current.assistant = result
			}
		case "turn.completed", "openade.turn_finished":
			if !completedCurrent && strings.TrimSpace(current.assistant) != "" {
				current.assistantAt = stringField(event, "created_at")
				turns = append(turns, current)
				completedTurns = len(turns)
				completedCurrent = true
			}
		}
	}
	if completedTurns == 0 {
		return forkTranscript{}, fmt.Errorf("wait for a completed response before starting a side chat")
	}
	var context strings.Builder
	var prefix bytes.Buffer
	context.WriteString("This is a side chat forked from a completed conversation. Use the history below as prior context, then answer the new user message.\n\n")
	for index, t := range turns {
		for _, entry := range []map[string]string{
			{"type": "openade.user_message", "text": t.user, "created_at": t.userAt},
			{"type": "openade.agent_message", "id": fmt.Sprintf("fork-history-%d", index), "text": t.assistant},
			{"type": "openade.turn_finished", "created_at": t.assistantAt},
		} {
			encoded, marshalErr := json.Marshal(entry)
			if marshalErr != nil {
				return forkTranscript{}, marshalErr
			}
			prefix.Write(encoded)
			prefix.WriteByte('\n')
		}
		context.WriteString("User: ")
		context.WriteString(t.user)
		context.WriteString("\n\nAssistant: ")
		context.WriteString(t.assistant)
		context.WriteString("\n\n")
		if context.Len() > maxForkContext {
			return forkTranscript{}, fmt.Errorf("conversation history is too large to fork safely")
		}
	}
	return forkTranscript{prefix: prefix.Bytes(), context: context.String()}, nil
}

func stringField(value map[string]any, key string) string {
	result, _ := value[key].(string)
	return result
}
