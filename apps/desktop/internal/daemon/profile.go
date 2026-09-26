package daemon

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const EngineProtocol = 5

func ProfileID(dataDir string) string {
	root, _ := filepath.Abs(dataDir)
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	sum := sha256.Sum256([]byte(filepath.Clean(root)))
	return hex.EncodeToString(sum[:8])
}
func EngineURL(config Config) string { return "http://" + config.Addr }
func EngineToken(dataDir string) (string, error) {
	if token := os.Getenv("OPENADE_AUTH_TOKEN"); token != "" {
		if len(token) < 24 {
			return "", fmt.Errorf("engine token must contain at least 24 characters")
		}
		return token, nil
	}
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return "", err
	}
	path := filepath.Join(dataDir, "engine.token")
	data, err := os.ReadFile(path)
	if err == nil {
		value := strings.TrimSpace(string(data))
		if len(value) < 24 {
			return "", fmt.Errorf("invalid engine token")
		}
		return value, nil
	}
	if !os.IsNotExist(err) {
		return "", err
	}
	buffer := make([]byte, 32)
	if _, err = rand.Read(buffer); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buffer)
	file, err := os.CreateTemp(dataDir, ".engine-token-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	if _, err = file.WriteString(token); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	// Link publishes a complete token without replacing another process's token.
	// A client window and its freshly launched engine may arrive concurrently.
	if err = os.Link(file.Name(), path); os.IsExist(err) {
		data, err = os.ReadFile(path)
		if err != nil {
			return "", err
		}
		value := strings.TrimSpace(string(data))
		if len(value) < 24 {
			return "", fmt.Errorf("invalid engine token")
		}
		return value, nil
	}
	if err != nil {
		return "", err
	}
	return token, nil

}
func validateLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("engine address must use a loopback IP")
	}
	return nil
}

var profileName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func providerHome() string {
	if value := os.Getenv("OPENADE_PROVIDER_HOME"); value != "" {
		return value
	}
	home, _ := os.UserHomeDir()
	return home
}
