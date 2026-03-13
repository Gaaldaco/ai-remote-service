import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/index.js";
import {
  consoleMessages,
  remediationLog,
  machineSnapshots,
  knowledgeBase,
  agents,
  alerts,
} from "../db/schema.js";
import { eq, desc, asc, and } from "drizzle-orm";

const router = Router();

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-20250514";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (match) return match[1].trim();
  return text.trim();
}

// GET /:agentId/messages - conversation history
router.get("/:agentId/messages", async (req, res) => {
  const agentId = req.params.agentId as string;

  const messages = await db
    .select()
    .from(consoleMessages)
    .where(eq(consoleMessages.agentId, agentId))
    .orderBy(asc(consoleMessages.createdAt))
    .limit(200);

  res.json(messages);
});

// POST /:agentId/execute - queue a command for the agent
router.post("/:agentId/execute", async (req, res) => {
  const agentId = req.params.agentId as string;
  const { command } = req.body;

  if (!command || typeof command !== "string") {
    res.status(400).json({ error: "command is required" });
    return;
  }

  // Log command to console history
  await db.insert(consoleMessages).values({
    agentId,
    role: "command",
    content: command,
  });

  // Create remediation entry for agent to pick up
  const [entry] = await db
    .insert(remediationLog)
    .values({ agentId, command })
    .returning();

  res.json({ id: entry.id, status: "queued" });
});

// GET /:agentId/result/:remediationId - poll for command result
router.get("/:agentId/result/:remediationId", async (req, res) => {
  const remediationId = req.params.remediationId as string;

  const [entry] = await db
    .select()
    .from(remediationLog)
    .where(eq(remediationLog.id, remediationId))
    .limit(1);

  if (!entry) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (entry.success === null) {
    // Still pending
    res.json({ status: "pending" });
    return;
  }

  res.json({
    status: "complete",
    output: entry.result,
    success: entry.success,
    executedAt: entry.executedAt,
  });
});

// POST /:agentId/ask - ask AI about the machine (with context)
router.post("/:agentId/ask", async (req, res) => {
  const agentId = req.params.agentId as string;
  const { message, terminalHistory } = req.body;

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (!client) {
    res.json({ response: "AI unavailable — ANTHROPIC_API_KEY not configured", model: null });
    return;
  }

  // Fetch machine context
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  const [latestSnapshot] = await db
    .select()
    .from(machineSnapshots)
    .where(eq(machineSnapshots.agentId, agentId))
    .orderBy(desc(machineSnapshots.timestamp))
    .limit(1);

  const unresolvedAlerts = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.agentId, agentId), eq(alerts.resolved, false)))
    .orderBy(desc(alerts.createdAt))
    .limit(10);

  const kbEntries = agent
    ? await db.select().from(knowledgeBase).where(eq(knowledgeBase.platform, agent.platform)).limit(20)
    : [];

  const systemPrompt = `You are an AI sysadmin assistant connected to a live Linux terminal on "${agent?.hostname ?? "unknown"}".
You can see the machine's current state, alerts, and terminal history.
Your job: help the user troubleshoot issues, suggest commands, and document solutions.

When suggesting a command, wrap it in a special block:
\`\`\`suggest
{"command": "the command to run", "reason": "why this will help"}
\`\`\`

When you've identified a working solution to document, use:
\`\`\`solution
{"pattern": "issue description", "command": "fix command", "description": "explanation"}
\`\`\`

Be concise and direct. Give one clear suggestion at a time.`;

  const userContent = `## Machine State
Host: ${agent?.hostname ?? "unknown"} (${agent?.os ?? "unknown"}, ${agent?.arch ?? "unknown"})
${latestSnapshot ? `CPU: ${(latestSnapshot.cpu as any)?.usagePercent?.toFixed(1)}% | Memory: ${(latestSnapshot.memory as any)?.usagePercent?.toFixed(1)}% | Disk: ${((latestSnapshot.disk as any)?.[0]?.usagePercent ?? 0).toFixed(0)}%` : "No snapshot data"}

## Active Alerts (${unresolvedAlerts.length})
${unresolvedAlerts.map((a) => `- [${a.severity}] ${a.message}`).join("\n") || "None"}

## Known Solutions
${kbEntries.map((k) => `- ${k.issuePattern}: ${k.solution}`).join("\n") || "None"}

## Terminal History
${terminalHistory || "(empty session)"}

## User Message
${message}`;

  const model = HAIKU_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const aiText = response.content[0].type === "text" ? response.content[0].text : "";
  console.log(`[console] AI response by ${model}`);

  // Log AI response
  await db.insert(consoleMessages).values({
    agentId,
    role: "assistant",
    content: aiText,
    model,
  });

  // Check for solution block → auto-create KB entry
  const solutionMatch = aiText.match(/```solution\n([\s\S]*?)\n```/);
  if (solutionMatch) {
    try {
      const solution = JSON.parse(solutionMatch[1]);
      await db.insert(knowledgeBase).values({
        issuePattern: solution.pattern,
        issueCategory: "console",
        platform: agent?.platform ?? "linux",
        solution: solution.command,
        description: solution.description,
      });
      console.log(`[console] KB entry created: ${solution.pattern}`);
    } catch {
      // ignore parse errors
    }
  }

  // Extract suggestion if present
  let suggestion = null;
  const suggestMatch = aiText.match(/```suggest\n([\s\S]*?)\n```/);
  if (suggestMatch) {
    try {
      suggestion = JSON.parse(suggestMatch[1]);
    } catch {
      // ignore
    }
  }

  res.json({ response: aiText, model, suggestion });
});

export default router;
