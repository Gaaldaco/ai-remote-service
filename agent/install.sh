#!/bin/bash
set -e

# AI Remote Agent Installer
# Run as root: curl -sSL https://YOUR_API_URL/install.sh | sudo bash

REPO="Gaaldaco/ai-remote-service"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/ai-remote-agent"
LOG_DIR="/var/log/ai-remote-agent"
SERVICE_FILE="/etc/systemd/system/ai-remote-agent.service"
BINARY_NAME="ai-remote-agent"

echo "=== AI Remote Agent Installer ==="
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run as root (sudo bash install.sh)"
  exit 1
fi

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
  x86_64)
    BINARY_SUFFIX="linux-amd64"
    ;;
  aarch64|arm64)
    BINARY_SUFFIX="linux-arm64"
    ;;
  *)
    echo "Error: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

echo "Detected architecture: $ARCH ($BINARY_SUFFIX)"

# Download latest binary from GitHub releases
echo "Downloading latest agent binary..."
LATEST_URL="https://github.com/${REPO}/releases/latest/download/${BINARY_NAME}-${BINARY_SUFFIX}"

if command -v curl &> /dev/null; then
  HTTP_CODE=$(curl -sL -w "%{http_code}" -o "/tmp/${BINARY_NAME}" "$LATEST_URL")
  if [ "$HTTP_CODE" != "200" ]; then
    echo "Error: Failed to download binary (HTTP $HTTP_CODE)"
    echo "URL: $LATEST_URL"
    echo "Make sure a release exists at https://github.com/${REPO}/releases"
    exit 1
  fi
elif command -v wget &> /dev/null; then
  wget -q -O "/tmp/${BINARY_NAME}" "$LATEST_URL" || {
    echo "Error: Failed to download binary"
    exit 1
  }
else
  echo "Error: curl or wget required"
  exit 1
fi

echo "Download complete."

# Prompt for API URL and key
read -p "API URL (e.g., https://your-api.up.railway.app): " API_URL
if [ -z "$API_URL" ]; then
  echo "Error: API URL is required"
  exit 1
fi

read -p "Agent Name (e.g., web-server-01): " AGENT_NAME
if [ -z "$AGENT_NAME" ]; then
  AGENT_NAME=$(hostname)
fi

echo ""
echo "The agent needs to register with the API to get an API key."
echo "You can either:"
echo "  1) Register now (requires API to be accessible)"
echo "  2) Provide an existing API key"
echo ""
read -p "Choose (1 or 2): " CHOICE

API_KEY=""
if [ "$CHOICE" = "1" ]; then
  echo "Registering agent..."
  RESPONSE=$(curl -s -X POST "${API_URL}/api/agents/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${AGENT_NAME}\", \"hostname\": \"$(hostname)\", \"os\": \"$(uname -o)\", \"arch\": \"${ARCH}\", \"platform\": \"linux\"}")

  API_KEY=$(echo "$RESPONSE" | grep -o '"apiKey":"[^"]*"' | cut -d'"' -f4)
  AGENT_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$API_KEY" ]; then
    echo "Error: Registration failed. Response: $RESPONSE"
    exit 1
  fi

  echo "Registered! Agent ID: $AGENT_ID"
  echo "API Key: $API_KEY"
  echo ""
  echo "IMPORTANT: Save this API key — it will NOT be shown again."
  echo ""
else
  read -p "API Key: " API_KEY
  if [ -z "$API_KEY" ]; then
    echo "Error: API key is required"
    exit 1
  fi
fi

# Create directories
mkdir -p "$CONFIG_DIR"
mkdir -p "$LOG_DIR"

# Install binary
mv "/tmp/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

# Write config
cat > "${CONFIG_DIR}/config.yaml" <<EOF
api_url: "${API_URL}"
api_key: "${API_KEY}"
agent_name: "${AGENT_NAME}"
snapshot_interval: 60
heartbeat_interval: 30
command_poll_interval: 10
EOF

chmod 600 "${CONFIG_DIR}/config.yaml"

# Install systemd service
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=AI Remote Service Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ai-remote-agent
Restart=always
RestartSec=10
User=root
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-remote-agent

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
systemctl daemon-reload
systemctl enable ai-remote-agent
systemctl start ai-remote-agent

echo ""
echo "=== Installation Complete ==="
echo "Binary:  ${INSTALL_DIR}/${BINARY_NAME}"
echo "Config:  ${CONFIG_DIR}/config.yaml"
echo "Logs:    journalctl -u ai-remote-agent -f"
echo "Status:  systemctl status ai-remote-agent"
echo ""
