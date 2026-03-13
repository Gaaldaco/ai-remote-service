package executor

import (
	"context"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"
)

const (
	DefaultTimeout = 120 * time.Second
	MaxOutputBytes = 10 * 1024 // 10KB
)

// Allowlist of command prefixes that can be executed
var AllowedPrefixes = []string{
	"systemctl restart",
	"systemctl start",
	"systemctl stop",
	"systemctl reload",
	"systemctl status",
	"systemctl enable",
	"systemctl disable",
	"apt update",
	"apt upgrade",
	"apt install",
	"yum update",
	"yum install",
	"dnf update",
	"dnf install",
	"journalctl",
	"df",
	"free",
	"top -bn1",
	"ps aux",
	"ss -tlnp",
	"netstat",
	"ip addr",
	"ip route",
	"cat /var/log",
	"tail /var/log",
	"head /var/log",
	"grep",
	"find",
	"ls",
	"whoami",
	"uname",
	"uptime",
	"dmesg",
	"lsof",
	"kill",
	"reboot",
	"shutdown",
}

type Result struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
	Success  bool   `json:"success"`
}

func Execute(command string, timeout time.Duration) Result {
	if timeout == 0 {
		timeout = DefaultTimeout
	}

	// Check if command is allowed
	if !isAllowed(command) {
		return Result{
			Output:   fmt.Sprintf("command not allowed: %s", command),
			ExitCode: -1,
			Success:  false,
		}
	}

	log.Printf("[executor] Running: %s", command)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "bash", "-c", command)

	output, err := cmd.CombinedOutput()

	// Truncate output if too large
	outStr := string(output)
	if len(outStr) > MaxOutputBytes {
		outStr = outStr[:MaxOutputBytes] + "\n... [truncated]"
	}

	exitCode := 0
	success := true
	if err != nil {
		success = false
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
		if ctx.Err() == context.DeadlineExceeded {
			outStr += "\n[command timed out]"
			exitCode = -1
		}
	}

	log.Printf("[executor] Finished (exit=%d, success=%v): %s", exitCode, success, command)

	return Result{
		Output:   outStr,
		ExitCode: exitCode,
		Success:  success,
	}
}

func isAllowed(command string) bool {
	cmd := strings.TrimSpace(command)
	for _, prefix := range AllowedPrefixes {
		if strings.HasPrefix(cmd, prefix) {
			return true
		}
	}
	return false
}
