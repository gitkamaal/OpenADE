//go:build !darwin || !cgo

package daemon

import "fmt"

func systemImagePNG(format string, data []byte) ([]byte, error) {
	return nil, fmt.Errorf("native %s decoding is unavailable on this system", format)
}
