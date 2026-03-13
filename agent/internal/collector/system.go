package collector

import (
	"os"
	"runtime"
	"strings"
)

type SystemInfo struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Platform string `json:"platform"`
}

func CollectSystemInfo() SystemInfo {
	hostname, _ := os.Hostname()

	osInfo := runtime.GOOS
	// Try to get more detailed OS info on Linux
	if runtime.GOOS == "linux" {
		data, err := os.ReadFile("/etc/os-release")
		if err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				if strings.HasPrefix(line, "PRETTY_NAME=") {
					osInfo = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
					break
				}
			}
		}
	}

	return SystemInfo{
		Hostname: hostname,
		OS:       osInfo,
		Arch:     runtime.GOARCH,
		Platform: runtime.GOOS,
	}
}
