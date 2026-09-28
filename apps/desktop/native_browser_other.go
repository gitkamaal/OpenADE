//go:build !darwin

package main

import "fmt"

func (a *App) BrowserOpenTab(tab, address string, x, y, width, height float64) error {
	return fmt.Errorf("native browser is available on macOS")
}
func (a *App) BrowserNavigateTab(tab, address string) error {
	return fmt.Errorf("native browser is available on macOS")
}
func (a *App) BrowserBoundsTab(tab string, x, y, width, height float64) {}
func (a *App) BrowserActionTab(tab, action string)                      {}

func (a *App) SetAppearance(scheme, material string) string { return "unsupported" }
