package executor

import (
	"context"
	"log"
	"os/exec"
	"time"
)

const (
	DefaultTimeout = 120 * time.Second
	MaxOutputBytes = 10 * 1024 // 10KB
)

type Result struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
	Success  bool   `json:"success"`
}

func Execute(command string, timeout time.Duration) Result {
	if timeout == 0 {
		timeout = DefaultTimeout
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
