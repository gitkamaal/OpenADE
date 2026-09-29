package daemon

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
)

const transcriptPageBytes = 1024 * 1024

type TranscriptPage struct {
	Data    []byte `json:"data"`
	Offset  int64  `json:"offset"`
	Cursor  int64  `json:"cursor"`
	HasMore bool   `json:"has_more"`
}

// readTranscriptPage returns one bounded byte range before a stable cursor.
// Unlike the live replay, it does not discard incomplete edge lines: adjacent
// pages can be joined without losing a provider event at the boundary.
func readTranscriptPage(path string, before int64) (TranscriptPage, error) {
	file, err := os.Open(path)
	if err != nil {
		return TranscriptPage{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return TranscriptPage{}, err
	}
	end := before
	if end < 0 || end > info.Size() {
		end = info.Size()
	}
	start := end - transcriptPageBytes
	if start < 0 {
		start = 0
	}
	data := make([]byte, end-start)
	n, err := file.ReadAt(data, start)
	if err != nil && err != io.EOF {
		return TranscriptPage{}, err
	}
	data = data[:n]
	return TranscriptPage{Data: data, Offset: start, Cursor: start + int64(n), HasMore: start > 0}, nil
}

type Replay struct {
	Data   []byte
	Offset int64
	Cursor int64
	Reset  bool
}

func readReplay(path string, after int64) (Replay, error) {
	file, err := os.Open(path)
	if err != nil {
		return Replay{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return Replay{}, err
	}
	end := info.Size()
	start := after
	reset := after > end
	if reset {
		start = 0
	}
	floor := end - int64(maxScrollback)
	if floor < 0 {
		floor = 0
	}
	if start < floor {
		start = floor
		reset = true
	}
	if _, err = file.Seek(start, io.SeekStart); err != nil {
		return Replay{}, err
	}
	data, err := io.ReadAll(io.LimitReader(file, end-start))
	return Replay{Data: data, Offset: start, Cursor: start + int64(len(data)), Reset: reset}, err
}

// A forced JSONL replay starts at the scrollback floor, which can fall in the
// middle of an event or a UTF-8 rune. Drop only that incomplete leading line.
// Ordinary cursor resumes keep their bytes so an in-progress line can finish.
func readLineReplay(path string, after int64) (Replay, error) {
	replay, err := readReplay(path, after)
	if err != nil || !replay.Reset || replay.Offset == 0 || len(replay.Data) == 0 {
		return replay, err
	}
	file, err := os.Open(path)
	if err != nil {
		return Replay{}, err
	}
	defer file.Close()
	var previous [1]byte
	if _, err := file.ReadAt(previous[:], replay.Offset-1); err != nil {
		return Replay{}, err
	}
	if previous[0] == '\n' {
		return replay, nil
	}
	cut := bytes.IndexByte(replay.Data, '\n')
	if cut < 0 {
		replay.Offset = replay.Cursor
		replay.Data = nil
		return replay, nil
	}
	replay.Offset += int64(cut + 1)
	replay.Data = replay.Data[cut+1:]
	return replay, nil
}
func streamCursor(r *http.Request) (int64, error) {
	value := r.URL.Query().Get("after")
	if value == "" {
		return 0, nil
	}
	after, err := strconv.ParseInt(value, 10, 64)
	if err != nil || after < 0 {
		return 0, fmt.Errorf("invalid byte cursor")
	}
	return after, nil
}
