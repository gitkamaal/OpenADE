package main

import (
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SelectThemeSource intentionally returns only a user-picked path. The daemon
// owns reading and constraining that path, so the webview never receives file
// contents or broad filesystem access.
func (a *App) SelectThemeSource() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("desktop window is not ready")
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Choose a VS Code theme file",
		Filters: []runtime.FileFilter{{DisplayName: "Theme JSON", Pattern: "*.json;*.jsonc;*.json5"}},
	})
}

func (a *App) SelectThemePackage() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("desktop window is not ready")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose a VS Code theme extension folder"})
}
