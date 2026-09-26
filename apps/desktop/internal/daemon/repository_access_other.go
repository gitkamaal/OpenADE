//go:build !darwin

package daemon

func DirectoryBookmark(path string) (string, error) { return "", nil }
func grantDirectory(bookmark, path string) error    { return nil }
