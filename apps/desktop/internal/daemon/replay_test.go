package daemon

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestTranscriptPagesReassembleAcrossUTF8AndEventBoundaries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "transcript.log")
	original := bytes.Repeat([]byte("{\"text\":\"π replay\"}\n"), 170000)
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	before := int64(-1)
	var restored []byte
	pages := 0
	for {
		page, err := readTranscriptPage(path, before)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Data) > transcriptPageBytes || page.Cursor-page.Offset != int64(len(page.Data)) {
			t.Fatalf("invalid bounded page: %+v", page)
		}
		restored = append(page.Data, restored...)
		pages++
		if !page.HasMore {
			break
		}
		if page.Offset >= page.Cursor {
			t.Fatal("page cursor made no progress")
		}
		before = page.Offset
	}
	if pages < 3 || !bytes.Equal(restored, original) {
		t.Fatalf("reassembled %d pages into %d of %d bytes", pages, len(restored), len(original))
	}
	end, err := readTranscriptPage(path, int64(len(original))+123)
	if err != nil || end.Cursor != int64(len(original)) {
		t.Fatalf("future cursor was not clamped to the file end: %+v, %v", end, err)
	}
	empty, err := readTranscriptPage(path, 0)
	if err != nil || len(empty.Data) != 0 || empty.HasMore {
		t.Fatalf("zero cursor should be empty: %+v, %v", empty, err)
	}
}

func TestLineReplayDropsOnlyIncompleteLeadingEvent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "transcript.log")
	original := bytes.Repeat([]byte("{\"text\":\"π replay\"}\n"), 170000)
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	raw, err := readReplay(path, 0)
	if err != nil || !raw.Reset || raw.Offset == 0 {
		t.Fatalf("expected a forced replay from the scrollback floor: %+v, %v", raw, err)
	}
	if bytes.HasPrefix(raw.Data, []byte("{\"text\"")) {
		t.Fatal("fixture floor unexpectedly landed on an event boundary")
	}
	aligned, err := readLineReplay(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	if aligned.Cursor != int64(len(original)) || aligned.Offset < raw.Offset || !bytes.HasPrefix(aligned.Data, []byte("{\"text\"")) {
		t.Fatalf("line replay lost its cursor or first complete event: %+v", aligned)
	}
	if aligned.Offset > 0 && original[aligned.Offset-1] != '\n' {
		t.Fatal("replay did not begin after a complete line")
	}
	partial, err := readLineReplay(path, raw.Offset)
	if err != nil || partial.Reset || partial.Offset != raw.Offset || !bytes.Equal(partial.Data, raw.Data) {
		t.Fatalf("ordinary cursor continuation was changed: %+v, %v", partial, err)
	}
}
