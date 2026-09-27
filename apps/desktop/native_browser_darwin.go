//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit -framework QuartzCore
#include <stdlib.h>
void openadeBrowserShow(const char *url,double x,double y,double width,double height);
void openadeBrowserAction(int action);
int openadeAppearance(int appearance,int material);
*/
import "C"
import (
	"fmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"net/url"
	"sync"
	"unsafe"
)

var browserAppMu sync.RWMutex
var browserApp *App

func (a *App) BrowserNavigate(address string, x, y, width, height float64) error {
	parsed, err := url.Parse(address)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return fmt.Errorf("enter an HTTP or HTTPS address without credentials")
	}
	browserAppMu.Lock()
	browserApp = a
	browserAppMu.Unlock()
	value := C.CString(parsed.String())
	defer C.free(unsafe.Pointer(value))
	C.openadeBrowserShow(value, C.double(x), C.double(y), C.double(width), C.double(height))
	return nil
}
func (a *App) BrowserBounds(x, y, width, height float64) {
	C.openadeBrowserShow(nil, C.double(x), C.double(y), C.double(width), C.double(height))
}
func (a *App) BrowserAction(action string) {
	value := map[string]int{"close": 0, "back": 1, "forward": 2, "reload": 3, "hide": 4, "show": 5}
	if code, ok := value[action]; ok {
		C.openadeBrowserAction(C.int(code))
	}
}

//export openadeBrowserNavigated
func openadeBrowserNavigated(value *C.char, back, forward C.int) {
	address := C.GoString(value)
	browserAppMu.RLock()
	app := browserApp
	browserAppMu.RUnlock()
	if app != nil && app.ctx != nil {
		go runtime.EventsEmit(app.ctx, "browser:navigated", address, back != 0, forward != 0)
	}
}

var appearanceApp *App
var appearanceMu sync.RWMutex

func appearanceStatus(status int) string {
	return map[int]string{0: "opaque", 1: "frosted", 2: "liquid", 3: "reduced-transparency", 4: "increased-contrast", 5: "liquid-fallback"}[status]
}
func (a *App) SetAppearance(scheme, material string) string {
	appearanceMu.Lock()
	appearanceApp = a
	appearanceMu.Unlock()
	appearance := map[string]int{"system": 0, "light": 1, "dark": 2}[scheme]
	treatment := map[string]int{"opaque": 0, "frosted": 1, "liquid": 2}[material]
	return appearanceStatus(int(C.openadeAppearance(C.int(appearance), C.int(treatment))))
}

//export openadeAppearanceChanged
func openadeAppearanceChanged(status C.int) {
	appearanceMu.RLock()
	app := appearanceApp
	appearanceMu.RUnlock()
	if app != nil && app.ctx != nil {
		go runtime.EventsEmit(app.ctx, "appearance:changed", appearanceStatus(int(status)))
	}
}
