package reporter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	apiURL  string
	apiKey  string
	agentID string
	http    *http.Client
}

type RegisterRequest struct {
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Platform string `json:"platform"`
}

type RegisterResponse struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	APIKey string `json:"apiKey"`
}

type Command struct {
	ID      string `json:"id"`
	Command string `json:"command"`
}

type CommandResult struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
	Success  bool   `json:"success"`
}

func NewClient(apiURL, apiKey string) *Client {
	return &Client{
		apiURL: apiURL,
		apiKey: apiKey,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) SetAgentID(id string) {
	c.agentID = id
}

func (c *Client) Register(req RegisterRequest) (*RegisterResponse, error) {
	body, _ := json.Marshal(req)
	resp, err := c.doRequest("POST", "/api/agents/register", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("registration failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result RegisterResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) SendSnapshot(snapshot interface{}) error {
	body, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}

	resp, err := c.doRequest("POST", "/api/snapshots", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("snapshot submission failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

func (c *Client) SendHeartbeat() error {
	resp, err := c.doRequest("POST", "/api/snapshots/heartbeat", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("heartbeat failed (status %d)", resp.StatusCode)
	}
	return nil
}

func (c *Client) PollCommands() ([]Command, error) {
	resp, err := c.doRequest("GET", "/api/remediation/commands", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("command poll failed (status %d)", resp.StatusCode)
	}

	var commands []Command
	if err := json.NewDecoder(resp.Body).Decode(&commands); err != nil {
		return nil, err
	}
	return commands, nil
}

func (c *Client) ReportCommandResult(remediationID string, result CommandResult) error {
	body, _ := json.Marshal(result)
	resp, err := c.doRequest("POST", fmt.Sprintf("/api/remediation/%s/result", remediationID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("result report failed (status %d)", resp.StatusCode)
	}
	return nil
}

func (c *Client) doRequest(method, path string, body []byte) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequest(method, c.apiURL+path, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	return c.http.Do(req)
}
