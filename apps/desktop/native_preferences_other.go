//go:build !darwin

package main

import "context"

type NativeFont struct {
	Family    string `json:"family"`
	Monospace bool   `json:"monospace"`
}

func (a *App) FontCatalog() ([]NativeFont, error) { return []NativeFont{}, nil }
func (a *App) nativeReady(context.Context)        {}
