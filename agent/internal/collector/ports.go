package collector

import (
	"os/exec"
	"strconv"
	"strings"
)

type OpenPort struct {
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
	Process  string `json:"process,omitempty"`
	Address  string `json:"address"`
}

func CollectOpenPorts() []OpenPort {
	out, err := exec.Command("ss", "-tlnp").Output()
	if err != nil {
		return nil
	}

	var ports []OpenPort
	lines := strings.Split(string(out), "\n")
	for i, line := range lines {
		if i == 0 { // skip header
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		// Parse local address (e.g., "0.0.0.0:22" or "*:80" or ":::22")
		localAddr := fields[3]
		addr, portStr := parseAddress(localAddr)
		port, _ := strconv.Atoi(portStr)
		if port == 0 {
			continue
		}

		// Extract process name if available
		process := ""
		for _, f := range fields {
			if strings.HasPrefix(f, "users:") {
				// Parse users:(("sshd",pid=1234,fd=3))
				start := strings.Index(f, "((\"")
				end := strings.Index(f, "\",")
				if start >= 0 && end > start {
					process = f[start+3 : end]
				}
			}
		}

		ports = append(ports, OpenPort{
			Port:     port,
			Protocol: "tcp",
			Process:  process,
			Address:  addr,
		})
	}

	return ports
}

func parseAddress(addr string) (string, string) {
	// Handle IPv6 format [::]:port
	if strings.HasPrefix(addr, "[") {
		idx := strings.LastIndex(addr, "]:")
		if idx >= 0 {
			return addr[:idx+1], addr[idx+2:]
		}
	}

	// Handle :::port (IPv6 any)
	if strings.HasPrefix(addr, ":::") {
		return "::", addr[3:]
	}

	// Handle *:port
	if strings.HasPrefix(addr, "*:") {
		return "0.0.0.0", addr[2:]
	}

	// Handle regular ip:port
	idx := strings.LastIndex(addr, ":")
	if idx >= 0 {
		return addr[:idx], addr[idx+1:]
	}

	return addr, ""
}
