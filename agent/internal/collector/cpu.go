package collector

import (
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type CPUInfo struct {
	UsagePercent float64   `json:"usagePercent"`
	Cores        int       `json:"cores"`
	LoadAvg      []float64 `json:"loadAvg,omitempty"`
}

func CollectCPU() CPUInfo {
	cores := runtime.NumCPU()
	usage := getCPUUsage()
	loadAvg := getLoadAvg()

	return CPUInfo{
		UsagePercent: usage,
		Cores:        cores,
		LoadAvg:      loadAvg,
	}
}

func getCPUUsage() float64 {
	idle1, total1 := readCPUStat()
	time.Sleep(500 * time.Millisecond)
	idle2, total2 := readCPUStat()

	idleDelta := float64(idle2 - idle1)
	totalDelta := float64(total2 - total1)

	if totalDelta == 0 {
		return 0
	}
	return (1.0 - idleDelta/totalDelta) * 100.0
}

func readCPUStat() (idle, total uint64) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)
			if len(fields) < 5 {
				return 0, 0
			}
			var vals []uint64
			for _, f := range fields[1:] {
				v, _ := strconv.ParseUint(f, 10, 64)
				vals = append(vals, v)
				total += v
			}
			if len(vals) >= 4 {
				idle = vals[3]
			}
			return
		}
	}
	return 0, 0
}

func getLoadAvg() []float64 {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return nil
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return nil
	}
	result := make([]float64, 3)
	for i := 0; i < 3; i++ {
		result[i], _ = strconv.ParseFloat(fields[i], 64)
	}
	return result
}
