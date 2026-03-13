package collector

import (
	"os"
	"strconv"
	"strings"
)

type NetworkInfo struct {
	Interface string `json:"interface"`
	BytesSent uint64 `json:"bytesSent"`
	BytesRecv uint64 `json:"bytesRecv"`
}

func CollectNetwork() []NetworkInfo {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil
	}

	var interfaces []NetworkInfo
	lines := strings.Split(string(data), "\n")
	for i, line := range lines {
		if i < 2 { // skip headers
			continue
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		name := strings.TrimSpace(parts[0])
		if name == "lo" {
			continue
		}

		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}

		bytesRecv, _ := strconv.ParseUint(fields[0], 10, 64)
		bytesSent, _ := strconv.ParseUint(fields[8], 10, 64)

		interfaces = append(interfaces, NetworkInfo{
			Interface: name,
			BytesSent: bytesSent,
			BytesRecv: bytesRecv,
		})
	}

	return interfaces
}
