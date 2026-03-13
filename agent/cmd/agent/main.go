package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Gaaldaco/ai-remote-agent/internal/collector"
	"github.com/Gaaldaco/ai-remote-agent/internal/config"
	"github.com/Gaaldaco/ai-remote-agent/internal/executor"
	"github.com/Gaaldaco/ai-remote-agent/internal/reporter"
)

type Snapshot struct {
	Hostname       string                   `json:"hostname"`
	OS             string                   `json:"os"`
	Arch           string                   `json:"arch"`
	Platform       string                   `json:"platform"`
	CPU            collector.CPUInfo        `json:"cpu"`
	Memory         collector.MemoryInfo     `json:"memory"`
	Disk           []collector.DiskInfo     `json:"disk"`
	Network        []collector.NetworkInfo  `json:"network"`
	Processes      []collector.ProcessInfo  `json:"processes"`
	OpenPorts      []collector.OpenPort     `json:"openPorts"`
	Users          []collector.UserInfo     `json:"users"`
	AuthLogs       []collector.AuthLogEntry `json:"authLogs"`
	PendingUpdates []collector.UpdateInfo   `json:"pendingUpdates"`
	Services       []collector.ServiceInfo  `json:"services"`
}

func main() {
	configPath := flag.String("config", config.DefaultConfigPath, "Path to config file")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("[agent] AI Remote Agent starting...")

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("[agent] Failed to load config: %v", err)
	}

	if cfg.APIUrl == "" || cfg.APIKey == "" {
		log.Fatal("[agent] api_url and api_key must be set in config")
	}

	client := reporter.NewClient(cfg.APIUrl, cfg.APIKey)

	log.Printf("[agent] Connected to %s", cfg.APIUrl)
	log.Printf("[agent] Snapshot interval: %ds, Heartbeat: %ds, Command poll: %ds",
		cfg.SnapshotInterval, cfg.HeartbeatInterval, cfg.CommandPollInterval)

	// Start tickers
	snapshotTicker := time.NewTicker(time.Duration(cfg.SnapshotInterval) * time.Second)
	heartbeatTicker := time.NewTicker(time.Duration(cfg.HeartbeatInterval) * time.Second)
	commandTicker := time.NewTicker(time.Duration(cfg.CommandPollInterval) * time.Second)

	// Send initial snapshot immediately
	go sendSnapshot(client)

	// Signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	log.Println("[agent] Running. Press Ctrl+C to stop.")

	for {
		select {
		case <-snapshotTicker.C:
			go sendSnapshot(client)

		case <-heartbeatTicker.C:
			go func() {
				if err := client.SendHeartbeat(); err != nil {
					log.Printf("[agent] Heartbeat failed: %v", err)
				}
			}()

		case <-commandTicker.C:
			go pollCommands(client)

		case sig := <-sigChan:
			log.Printf("[agent] Received signal %v, shutting down...", sig)
			snapshotTicker.Stop()
			heartbeatTicker.Stop()
			commandTicker.Stop()
			os.Exit(0)
		}
	}
}

func sendSnapshot(client *reporter.Client) {
	log.Println("[agent] Collecting system data...")

	sysInfo := collector.CollectSystemInfo()
	cpu := collector.CollectCPU()
	memory := collector.CollectMemory()
	disk := collector.CollectDisk()
	network := collector.CollectNetwork()
	processes := collector.CollectProcesses()
	ports := collector.CollectOpenPorts()
	users := collector.CollectUsers()
	authLogs := collector.CollectAuthLogs()
	updates := collector.CollectPendingUpdates()
	services := collector.CollectServices()

	snapshot := Snapshot{
		Hostname:       sysInfo.Hostname,
		OS:             sysInfo.OS,
		Arch:           sysInfo.Arch,
		Platform:       sysInfo.Platform,
		CPU:            cpu,
		Memory:         memory,
		Disk:           disk,
		Network:        network,
		Processes:      processes,
		OpenPorts:      ports,
		Users:          users,
		AuthLogs:       authLogs,
		PendingUpdates: updates,
		Services:       services,
	}

	if err := client.SendSnapshot(snapshot); err != nil {
		log.Printf("[agent] Snapshot send failed: %v", err)
	} else {
		log.Printf("[agent] Snapshot sent (CPU: %.1f%%, Mem: %.1f%%, Services: %d)",
			cpu.UsagePercent, memory.UsagePercent, len(services))
	}
}

func pollCommands(client *reporter.Client) {
	commands, err := client.PollCommands()
	if err != nil {
		log.Printf("[agent] Command poll failed: %v", err)
		return
	}

	for _, cmd := range commands {
		log.Printf("[agent] Executing command: %s", cmd.Command)
		result := executor.Execute(cmd.Command, executor.DefaultTimeout)

		err := client.ReportCommandResult(cmd.ID, reporter.CommandResult{
			Output:   result.Output,
			ExitCode: result.ExitCode,
			Success:  result.Success,
		})
		if err != nil {
			log.Printf("[agent] Failed to report result for %s: %v", cmd.ID, err)
		}
	}
}
