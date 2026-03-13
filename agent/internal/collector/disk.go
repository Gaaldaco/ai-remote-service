package collector

import (
	"os/exec"
	"strconv"
	"strings"
)

type DiskInfo struct {
	Mountpoint   string  `json:"mountpoint"`
	TotalGB      float64 `json:"totalGB"`
	UsedGB       float64 `json:"usedGB"`
	UsagePercent float64 `json:"usagePercent"`
}

func CollectDisk() []DiskInfo {
	out, err := exec.Command("df", "-BG", "--output=target,size,used,pcent", "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs").Output()
	if err != nil {
		return nil
	}

	var disks []DiskInfo
	lines := strings.Split(string(out), "\n")
	for i, line := range lines {
		if i == 0 { // skip header
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		totalGB, _ := strconv.ParseFloat(strings.TrimSuffix(fields[1], "G"), 64)
		usedGB, _ := strconv.ParseFloat(strings.TrimSuffix(fields[2], "G"), 64)
		pctStr := strings.TrimSuffix(fields[3], "%")
		usagePct, _ := strconv.ParseFloat(pctStr, 64)

		disks = append(disks, DiskInfo{
			Mountpoint:   fields[0],
			TotalGB:      totalGB,
			UsedGB:       usedGB,
			UsagePercent: usagePct,
		})
	}

	return disks
}
