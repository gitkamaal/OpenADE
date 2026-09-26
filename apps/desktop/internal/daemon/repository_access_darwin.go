//go:build darwin

package daemon

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation
#include <stdlib.h>
char *openadeDirectoryBookmark(const char *path);
int openadeGrantDirectory(const char *bookmark,const char *path);
*/
import "C"
import (
	"fmt"
	"unsafe"
)

func DirectoryBookmark(path string) (string, error) {
	value := C.CString(path)
	defer C.free(unsafe.Pointer(value))
	bookmark := C.openadeDirectoryBookmark(value)
	if bookmark == nil {
		return "", fmt.Errorf("macOS could not retain access to the selected folder")
	}
	defer C.free(unsafe.Pointer(bookmark))
	return C.GoString(bookmark), nil
}
func grantDirectory(bookmark, path string) error {
	value := C.CString(bookmark)
	defer C.free(unsafe.Pointer(value))
	root := C.CString(path)
	defer C.free(unsafe.Pointer(root))
	if C.openadeGrantDirectory(value, root) == 0 {
		return fmt.Errorf("select the project folder again to renew macOS access")
	}
	return nil
}
