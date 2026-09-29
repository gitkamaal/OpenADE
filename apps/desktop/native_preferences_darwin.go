//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework CoreText
#include <stdlib.h>
char *openadeFontCatalog(void);
void openadeRestoreGeometry(const char *profile);
*/
import "C"
import (
	"context"
	"encoding/json"
	"github.com/hkd987/OpenADE/apps/desktop/internal/daemon"
	"unsafe"
)

type NativeFont struct {
	Family    string `json:"family"`
	Monospace bool   `json:"monospace"`
}

func (a *App) FontCatalog() ([]NativeFont, error) {
	raw := C.openadeFontCatalog()
	defer C.free(unsafe.Pointer(raw))
	var fonts []NativeFont
	err := json.Unmarshal([]byte(C.GoString(raw)), &fonts)
	return fonts, err
}
func (a *App) nativeReady(context.Context) {
	profile := C.CString(daemon.ProfileID(daemon.DefaultConfig().DataDir))
	defer C.free(unsafe.Pointer(profile))
	C.openadeRestoreGeometry(profile)
}
