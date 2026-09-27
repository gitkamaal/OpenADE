//go:build !darwin

package main

import "fmt"

func (a *App) RevealThemeSource(string) error {
	return fmt.Errorf("revealing theme sources is only available in the macOS desktop app")
}
