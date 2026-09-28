//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit -framework QuartzCore
#include <stdlib.h>
void openadeBrowserOpen(const char *tab,const char *url,double x,double y,double width,double height);
void openadeBrowserNavigate(const char *tab,const char *url);
void openadeBrowserBounds(const char *tab,double x,double y,double width,double height);
void openadeBrowserAction(const char *tab,int action);
int openadeAppearance(int appearance,int material);
*/
import "C"
import (
	"fmt"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"net/url"
	"strings"
	"sync"
	"unsafe"
)

var browserAppMu sync.RWMutex
var browserApp *App

func browserAddress(address string) (string, error) {
	parsed, err := url.Parse(address)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return "", fmt.Errorf("enter an HTTP or HTTPS address without credentials")
	}
	return parsed.String(), nil
}

func browserTabID(tab string) error {
	if tab == "browser" {
		return nil
	}
	if !strings.HasPrefix(tab, "browser:") || len(tab) != 44 {
		return fmt.Errorf("invalid browser tab")
	}
	if _, err := uuid.Parse(tab[8:]); err != nil {
		return fmt.Errorf("invalid browser tab")
	}
	return nil
}

func (a *App) BrowserOpenTab(tab, address string, x, y, width, height float64) error {
	if err := browserTabID(tab); err != nil {
		return err
	}
	normalized, err := browserAddress(address)
	if err != nil {
		return err
	}
	browserIconInvalidate(tab, normalized)
	browserAppMu.Lock()
	browserApp = a
	browserAppMu.Unlock()
	id, value := C.CString(tab), C.CString(normalized)
	defer C.free(unsafe.Pointer(id))
	defer C.free(unsafe.Pointer(value))
	C.openadeBrowserOpen(id, value, C.double(x), C.double(y), C.double(width), C.double(height))
	return nil
}

func (a *App) BrowserNavigateTab(tab, address string) error {
	if err := browserTabID(tab); err != nil {
		return err
	}
	normalized, err := browserAddress(address)
	if err != nil {
		return err
	}
	browserIconInvalidate(tab, normalized)
	id, value := C.CString(tab), C.CString(normalized)
	defer C.free(unsafe.Pointer(id))
	defer C.free(unsafe.Pointer(value))
	C.openadeBrowserNavigate(id, value)
	return nil
}

func (a *App) BrowserBoundsTab(tab string, x, y, width, height float64) {
	if browserTabID(tab) != nil {
		return
	}
	id := C.CString(tab)
	defer C.free(unsafe.Pointer(id))
	C.openadeBrowserBounds(id, C.double(x), C.double(y), C.double(width), C.double(height))
}

func (a *App) BrowserActionTab(tab, action string) {
	if browserTabID(tab) != nil {
		return
	}
	value := map[string]int{"close": 0, "back": 1, "forward": 2, "reload": 3, "hide": 4, "show": 5}
	if code, ok := value[action]; ok {
		if action == "close" {
			browserIconClose(tab)
		} else if action == "back" || action == "forward" || action == "reload" {
			browserIconInvalidate(tab, "")
		}
		id := C.CString(tab)
		defer C.free(unsafe.Pointer(id))
		C.openadeBrowserAction(id, C.int(code))
	}
}

//export openadeBrowserChanged
func openadeBrowserChanged(tab, value, title *C.char, back, forward C.int) {
	id := C.GoString(tab)
	address := C.GoString(value)
	label := C.GoString(title)
	browserIconObserve(id, address)
	browserAppMu.RLock()
	app := browserApp
	browserAppMu.RUnlock()
	if app != nil && app.ctx != nil {
		go runtime.EventsEmit(app.ctx, "browser:state", id, address, label, back != 0, forward != 0)
	}
}

//export openadeBrowserNewTab
func openadeBrowserNewTab(tab, value *C.char) {
	browserAppMu.RLock()
	app := browserApp
	browserAppMu.RUnlock()
	if app != nil && app.ctx != nil {
		go runtime.EventsEmit(app.ctx, "browser:new-tab", C.GoString(tab), C.GoString(value))
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
	// Older clients' removed clear mode also resolves to a frosted material.
	treatment := map[string]int{"opaque": 0, "frosted": 1, "liquid": 2, "transparent": 1}[material]
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
