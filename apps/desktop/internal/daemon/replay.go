package daemon

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
)

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
