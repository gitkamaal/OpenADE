//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit -framework QuartzCore
#include <stdlib.h>
void openadeBrowserShow(const char *url,double x,double y,double width,double height);
void openadeBrowserAction(int action);
void openadeAppearance(int appearance,int frosted);
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

func (a *App) SetAppearance(scheme, material string) {
	appearance := map[string]int{"system": 0, "light": 1, "dark": 2}[scheme]
	frost := 0
	if material == "frosted" {
		frost = 1
	}
	C.openadeAppearance(C.int(appearance), C.int(frost))
}
