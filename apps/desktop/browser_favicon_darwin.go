//go:build darwin

package main

/*
#cgo LDFLAGS: -framework ImageIO
#include <stdlib.h>
int openadeBrowserIconPNG(const void *input, size_t length, void **output, size_t *outputLength);
*/
import "C"

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const maxBrowserIconBytes = 1024 * 1024

type browserIconRequest struct {
	page       string
	generation uint64
	cancel     context.CancelFunc
}

var browserIcons = struct {
	sync.Mutex
	tabs map[string]browserIconRequest
}{tabs: make(map[string]browserIconRequest)}

func browserIconObserve(tab, page string) {
	browserIcons.Lock()
	defer browserIcons.Unlock()
	current, ok := browserIcons.tabs[tab]
	if !ok {
		return
	}
	if current.page == page {
		return
	}
	if current.cancel != nil {
		current.cancel()
	}
	current.page, current.generation, current.cancel = page, current.generation+1, nil
	browserIcons.tabs[tab] = current
}

func browserIconInvalidate(tab, page string) {
	browserIcons.Lock()
	defer browserIcons.Unlock()
	current := browserIcons.tabs[tab]
	if current.cancel != nil {
		current.cancel()
	}
	current.page, current.generation, current.cancel = page, current.generation+1, nil
	browserIcons.tabs[tab] = current
}

func browserIconClose(tab string) {
	browserIcons.Lock()
	defer browserIcons.Unlock()
	if current, ok := browserIcons.tabs[tab]; ok {
		if current.cancel != nil {
			current.cancel()
		}
		delete(browserIcons.tabs, tab)
	}
}

//export openadeBrowserFavicon
func openadeBrowserFavicon(tab, page, candidate *C.char) {
	id, pageURL, iconURL := C.GoString(tab), C.GoString(page), C.GoString(candidate)
	if browserTabID(id) != nil || len(pageURL) > 8192 || len(iconURL) > 8192 {
		return
	}
	if _, err := browserAddress(iconURL); err != nil {
		return
	}
	browserIcons.Lock()
	current, ok := browserIcons.tabs[id]
	if !ok || current.page != pageURL {
		browserIcons.Unlock()
		return
	}
	if current.cancel != nil {
		current.cancel()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	current.generation++
	current.cancel = cancel
	browserIcons.tabs[id] = current
	generation := current.generation
	browserIcons.Unlock()
	go func() {
		defer cancel()
		png := fetchBrowserIcon(ctx, iconURL)
		if len(png) == 0 {
			return
		}
		browserIcons.Lock()
		latest, ok := browserIcons.tabs[id]
		if ok && latest.page == pageURL && latest.generation == generation {
			latest.cancel = nil
			browserIcons.tabs[id] = latest
		} else {
			ok = false
		}
		browserIcons.Unlock()
		if !ok {
			return
		}
		browserAppMu.RLock()
		app := browserApp
		browserAppMu.RUnlock()
		if app != nil && app.ctx != nil {
			runtime.EventsEmit(app.ctx, "browser:favicon", id, pageURL, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png))
		}
	}()
}

func fetchBrowserIcon(ctx context.Context, candidate string) []byte {
	address, err := url.Parse(candidate)
	if err != nil || address.Host == "" {
		return nil
	}
	base, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return nil
	}
	transport := base.Clone()
	host, ip := address.Hostname(), net.ParseIP(address.Hostname())
	if strings.EqualFold(strings.TrimSuffix(host, "."), "localhost") || (ip != nil && ip.IsLoopback()) {
		transport.Proxy = nil
	}
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if len(via) > 3 {
			return errors.New("favicon redirected too often")
		}
		_, err := browserAddress(request.URL.String())
		return err
	}}
	defer transport.CloseIdleConnections()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, candidate, nil)
	if err != nil {
		return nil
	}
	response, err := client.Do(request)
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 || response.ContentLength > maxBrowserIconBytes {
		return nil
	}
	bytes, err := io.ReadAll(io.LimitReader(response.Body, maxBrowserIconBytes+1))
	if err != nil || len(bytes) == 0 || len(bytes) > maxBrowserIconBytes {
		return nil
	}
	var output unsafe.Pointer
	var length C.size_t
	if C.openadeBrowserIconPNG(unsafe.Pointer(&bytes[0]), C.size_t(len(bytes)), &output, &length) != 0 || output == nil {
		return nil
	}
	defer C.free(output)
	return C.GoBytes(output, C.int(length))
}
