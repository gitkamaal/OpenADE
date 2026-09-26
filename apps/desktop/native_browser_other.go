//go:build !darwin

package main

import "fmt"

func (a *App) BrowserNavigate(address string, x, y, width, height float64) error {
	return fmt.Errorf("native browser is available on macOS")
}
func (a *App) BrowserBounds(x, y, width, height float64) {}
func (a *App) BrowserAction(action string)               {}

func (a *App) SetAppearance(scheme, material string) {}
