package collector

import (
	"encoding/json"
	"os/exec"
	"strings"
)

type ServiceInfo struct {
	Name    string  `json:"name"`
	Status  string  `json:"status"` // running | stopped | failed | inactive
	Enabled bool    `json:"enabled"`
	CPU     float64 `json:"cpu,omitempty"`
	Mem     float64 `json:"mem,omitempty"`
}

type systemctlUnit struct {
	Unit   string `json:"unit"`
	Load   string `json:"load"`
	Active string `json:"active"`
	Sub    string `json:"sub"`
}

func CollectServices() []ServiceInfo {
	out, err := exec.Command("systemctl", "list-units", "--type=service", "--all", "--output=json").Output()
	if err != nil {
		return collectServicesFallback()
	}

	var units []systemctlUnit
	if err := json.Unmarshal(out, &units); err != nil {
		return collectServicesFallback()
	}

	var services []ServiceInfo
	for _, u := range units {
		if u.Unit == "" {
			continue
		}

		status := "inactive"
		switch u.Sub {
		case "running":
			status = "running"
		case "dead", "inactive":
			status = "stopped"
		case "failed":
			status = "failed"
		default:
			status = u.Sub
		}

		// Check if enabled
		enabled := isServiceEnabled(u.Unit)

		services = append(services, ServiceInfo{
			Name:    u.Unit,
			Status:  status,
			Enabled: enabled,
		})
	}

	return services
}

func isServiceEnabled(unit string) bool {
	out, err := exec.Command("systemctl", "is-enabled", unit).Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(out)) == "enabled"
}

func collectServicesFallback() []ServiceInfo {
	out, err := exec.Command("systemctl", "list-units", "--type=service", "--all", "--no-pager", "--plain").Output()
	if err != nil {
		return nil
	}

	var services []ServiceInfo
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		if !strings.HasSuffix(fields[0], ".service") {
			continue
		}

		status := "inactive"
		switch fields[3] {
		case "running":
			status = "running"
		case "dead":
			status = "stopped"
		case "failed":
			status = "failed"
		default:
			status = fields[3]
		}

		services = append(services, ServiceInfo{
			Name:    fields[0],
			Status:  status,
			Enabled: isServiceEnabled(fields[0]),
		})
	}

	return services
}
