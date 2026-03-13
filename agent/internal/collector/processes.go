package collector

import (
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

type ProcessInfo struct {
	PID  int     `json:"pid"`
	Name string  `json:"name"`
	CPU  float64 `json:"cpu"`
	Mem  float64 `json:"mem"`
	User string  `json:"user"`
}

func CollectProcesses() []ProcessInfo {
	out, err := exec.Command("ps", "aux", "--sort=-pcpu").Output()
	if err != nil {
		return nil
	}

	var procs []ProcessInfo
	lines := strings.Split(string(out), "\n")
	for i, line := range lines {
		if i == 0 { // skip header
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 11 {
			continue
		}

		pid, _ := strconv.Atoi(fields[1])
		cpu, _ := strconv.ParseFloat(fields[2], 64)
		mem, _ := strconv.ParseFloat(fields[3], 64)

		// Command is fields[10:]
		name := strings.Join(fields[10:], " ")
		// Truncate long command names
		if len(name) > 100 {
			name = name[:100]
		}

		procs = append(procs, ProcessInfo{
			PID:  pid,
			Name: name,
			CPU:  cpu,
			Mem:  mem,
			User: fields[0],
		})
	}

	// Sort by CPU desc, take top 50
	sort.Slice(procs, func(i, j int) bool {
		return procs[i].CPU > procs[j].CPU
	})

	if len(procs) > 50 {
		procs = procs[:50]
	}

	return procs
}
