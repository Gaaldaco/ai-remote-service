package collector

import (
	"os/exec"
	"strings"
)

type AuthLogEntry struct {
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	User      string `json:"user,omitempty"`
	Source    string `json:"source,omitempty"`
	Success   bool   `json:"success"`
}

func CollectAuthLogs() []AuthLogEntry {
	// Try journalctl first (works on most systemd systems)
	out, err := exec.Command("journalctl", "-u", "sshd", "-u", "ssh", "--no-pager", "-n", "100", "--output=short-iso").Output()
	if err != nil {
		return collectAuthLogFile()
	}

	return parseAuthLines(string(out))
}

func collectAuthLogFile() []AuthLogEntry {
	// Fallback: read /var/log/auth.log directly
	out, err := exec.Command("tail", "-n", "100", "/var/log/auth.log").Output()
	if err != nil {
		// Try /var/log/secure (RHEL/CentOS)
		out, err = exec.Command("tail", "-n", "100", "/var/log/secure").Output()
		if err != nil {
			return nil
		}
	}
	return parseAuthLines(string(out))
}

func parseAuthLines(data string) []AuthLogEntry {
	var entries []AuthLogEntry
	lines := strings.Split(data, "\n")

	for _, line := range lines {
		if line == "" {
			continue
		}

		entry := AuthLogEntry{
			Timestamp: extractTimestamp(line),
		}

		switch {
		case strings.Contains(line, "Accepted"):
			entry.Type = "login_success"
			entry.Success = true
			entry.User = extractUser(line)
			entry.Source = extractSource(line)
		case strings.Contains(line, "Failed password"):
			entry.Type = "login_failed"
			entry.Success = false
			entry.User = extractUser(line)
			entry.Source = extractSource(line)
		case strings.Contains(line, "Invalid user"):
			entry.Type = "invalid_user"
			entry.Success = false
			entry.User = extractInvalidUser(line)
			entry.Source = extractSource(line)
		case strings.Contains(line, "session opened"):
			entry.Type = "session_opened"
			entry.Success = true
			entry.User = extractUser(line)
		case strings.Contains(line, "session closed"):
			entry.Type = "session_closed"
			entry.Success = true
			entry.User = extractUser(line)
		default:
			continue // skip non-auth lines
		}

		entries = append(entries, entry)
	}

	return entries
}

func extractTimestamp(line string) string {
	// ISO format from journalctl: "2024-01-15T10:30:00+0000"
	fields := strings.Fields(line)
	if len(fields) > 0 {
		return fields[0]
	}
	return ""
}

func extractUser(line string) string {
	// "for <user> from" or "user=<user>"
	if idx := strings.Index(line, "for "); idx >= 0 {
		rest := line[idx+4:]
		fields := strings.Fields(rest)
		if len(fields) > 0 {
			return fields[0]
		}
	}
	return ""
}

func extractInvalidUser(line string) string {
	if idx := strings.Index(line, "Invalid user "); idx >= 0 {
		rest := line[idx+13:]
		fields := strings.Fields(rest)
		if len(fields) > 0 {
			return fields[0]
		}
	}
	return ""
}

func extractSource(line string) string {
	if idx := strings.Index(line, "from "); idx >= 0 {
		rest := line[idx+5:]
		fields := strings.Fields(rest)
		if len(fields) > 0 {
			return fields[0]
		}
	}
	return ""
}
