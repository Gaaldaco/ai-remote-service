import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { WebSocketServer } from "ws";

import agentsRouter from "./routes/agents.js";
import snapshotsRouter from "./routes/snapshots.js";
import alertsRouter from "./routes/alerts.js";
import servicesRouter from "./routes/services.js";
import knowledgeBaseRouter from "./routes/knowledgeBase.js";
import remediationRouter from "./routes/remediation.js";
import { errorHandler } from "./middleware/error.js";
import { startHeartbeatMonitor } from "./lib/heartbeat.js";

const app = express();
const PORT = Number(process.env.PORT ?? 8080);

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet());

const allowedOrigins = [
  process.env.FRONTEND_URL ?? "http://localhost:5173",
  ...(process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.some((o) => origin.startsWith(o))) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    },
    credentials: true,
  })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ai-remote-service-api", timestamp: new Date().toISOString() });
});

// ─── Install script endpoint ─────────────────────────────────────────────────
app.get("/install.sh", (_req, res) => {
  const repo = "Gaaldaco/ai-remote-service";
  const script = `#!/bin/bash
set -e
echo "Downloading installer..."
curl -sSL "https://raw.githubusercontent.com/${repo}/main/agent/install.sh" -o /tmp/ai-remote-agent-install.sh
chmod +x /tmp/ai-remote-agent-install.sh
bash /tmp/ai-remote-agent-install.sh
rm -f /tmp/ai-remote-agent-install.sh`;
  res.setHeader("Content-Type", "text/plain");
  res.send(script);
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/agents", agentsRouter);
app.use("/api/snapshots", snapshotsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/services", servicesRouter);
app.use("/api/knowledge-base", knowledgeBaseRouter);
app.use("/api/remediation", remediationRouter);

// ─── Error handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[api] AI Remote Service API listening on port ${PORT}`);
});

// ─── WebSocket server for real-time updates ──────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("[ws] Client connected");
  ws.on("close", () => console.log("[ws] Client disconnected"));
});

// Export for use by workers to broadcast events
export function broadcast(event: string, data: unknown) {
  const message = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// ─── Background tasks ────────────────────────────────────────────────────────
startHeartbeatMonitor();
