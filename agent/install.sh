#!/bin/bash
set -e

# AI Remote Agent Installer
# Run: curl -sSL https://api-production-64cc.up.railway.app/install.sh | bash

API_URL="https://api-production-64cc.up.railway.app"
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
  echo "Error: Please run as root"
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

echo "Architecture: $ARCH ($BINARY_SUFFIX)"
echo "API: $API_URL"
echo ""

# Download latest binary
echo "Downloading agent binary..."
LATEST_URL="https://github.com/${REPO}/releases/latest/download/${BINARY_NAME}-${BINARY_SUFFIX}"
HTTP_CODE=$(curl -sL -w "%{http_code}" -o "/tmp/${BINARY_NAME}" "$LATEST_URL")
if [ "$HTTP_CODE" != "200" ]; then
  echo "Error: Failed to download binary (HTTP $HTTP_CODE)"
  exit 1
fi
echo "Download complete."
echo ""

# Agent name
read -p "Agent Name [$(hostname)]: " AGENT_NAME
if [ -z "$AGENT_NAME" ]; then
  AGENT_NAME=$(hostname)
fi

# Register with API
echo ""
echo "Registering agent with API..."
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
echo ""
echo "  API Key: $API_KEY"
echo "  SAVE THIS KEY — it will NOT be shown again."
echo ""

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
command_poll_interval: 5
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
