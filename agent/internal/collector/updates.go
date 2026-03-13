package collector

import (
	"os/exec"
	"strings"
)

type UpdateInfo struct {
	Package        string `json:"package"`
	CurrentVersion string `json:"currentVersion,omitempty"`
	NewVersion     string `json:"newVersion,omitempty"`
}

func CollectPendingUpdates() []UpdateInfo {
	// Try apt (Debian/Ubuntu)
	updates := tryApt()
	if updates != nil {
		return updates
	}

	// Try yum/dnf (RHEL/CentOS/Fedora)
	updates = tryYum()
	if updates != nil {
		return updates
	}

	return nil
}

func tryApt() []UpdateInfo {
	out, err := exec.Command("apt", "list", "--upgradable").Output()
	if err != nil {
		return nil
	}

	var updates []UpdateInfo
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		if line == "" || strings.HasPrefix(line, "Listing") {
			continue
		}

		// Format: "package/source version arch [upgradable from: old_version]"
		parts := strings.SplitN(line, "/", 2)
		if len(parts) < 2 {
			continue
		}

		pkgName := parts[0]
		rest := parts[1]
		fields := strings.Fields(rest)

		newVersion := ""
		if len(fields) >= 2 {
			newVersion = fields[1]
		}

		currentVersion := ""
		if idx := strings.Index(rest, "upgradable from: "); idx >= 0 {
			cv := rest[idx+17:]
			cv = strings.TrimSuffix(cv, "]")
			currentVersion = strings.TrimSpace(cv)
		}

		updates = append(updates, UpdateInfo{
			Package:        pkgName,
			CurrentVersion: currentVersion,
			NewVersion:     newVersion,
		})
	}

	return updates
}

func tryYum() []UpdateInfo {
	out, err := exec.Command("yum", "check-update", "--quiet").Output()
	if err != nil {
		// yum check-update returns exit code 100 when updates are available
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 100 {
			out = exitErr.Stderr
			if len(out) == 0 {
				out = []byte(exitErr.Error())
			}
		} else {
			return nil
		}
	}

	var updates []UpdateInfo
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		updates = append(updates, UpdateInfo{
			Package:    fields[0],
			NewVersion: fields[1],
		})
	}

	return updates
}
