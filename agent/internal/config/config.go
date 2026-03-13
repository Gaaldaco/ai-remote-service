package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	APIUrl           string `yaml:"api_url"`
	APIKey           string `yaml:"api_key"`
	AgentName        string `yaml:"agent_name"`
	SnapshotInterval int    `yaml:"snapshot_interval"` // seconds
	HeartbeatInterval int   `yaml:"heartbeat_interval"` // seconds
	CommandPollInterval int  `yaml:"command_poll_interval"` // seconds
}

const DefaultConfigPath = "/etc/ai-remote-agent/config.yaml"

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		SnapshotInterval:    60,
		HeartbeatInterval:   30,
		CommandPollInterval: 10,
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) Save(path string) error {
	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}
