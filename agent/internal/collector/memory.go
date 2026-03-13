package collector

import (
	"os"
	"strconv"
	"strings"
)

type MemoryInfo struct {
	TotalMB      float64 `json:"totalMB"`
	UsedMB       float64 `json:"usedMB"`
	UsagePercent float64 `json:"usagePercent"`
}

func CollectMemory() MemoryInfo {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return MemoryInfo{}
	}

	values := make(map[string]uint64)
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		valStr := strings.TrimSpace(parts[1])
		valStr = strings.TrimSuffix(valStr, " kB")
		valStr = strings.TrimSpace(valStr)
		val, _ := strconv.ParseUint(valStr, 10, 64)
		values[key] = val
	}

	totalKB := values["MemTotal"]
	availKB := values["MemAvailable"]
	usedKB := totalKB - availKB

	totalMB := float64(totalKB) / 1024.0
	usedMB := float64(usedKB) / 1024.0
	usagePercent := 0.0
	if totalKB > 0 {
		usagePercent = (float64(usedKB) / float64(totalKB)) * 100.0
	}

	return MemoryInfo{
		TotalMB:      totalMB,
		UsedMB:       usedMB,
		UsagePercent: usagePercent,
	}
}
