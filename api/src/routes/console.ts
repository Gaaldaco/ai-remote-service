import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/index.js";
import {
  consoleMessages,
  remediationLog,
  machineSnapshots,
  knowledgeBase,
  agents,
} from "../db/schema.js";
import { eq, desc, asc } from "drizzle-orm";
import { agentAuth } from "../middleware/agentAuth.js";

const router = Router();

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-20250514";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// GET /:agentId/messages - last 100 messages
router.get("/:agentId/messages", async (req, res) => {
  const agentId = req.params.agentId as string;

  const messages = await db
    .select()
    .from(consoleMessages)
    .where(eq(consoleMessages.agentId, agentId))
    .orderBy(asc(consoleMessages.createdAt))
    .limit(100);

  res.json(messages);
});

// POST /:agentId/send - send a message (user chat or command)
router.post("/:agentId/send", async (req, res) => {
  const agentId = req.params.agentId as string;
  const { message } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Store user message
  await db.insert(consoleMessages).values({
    agentId,
    role: "user",
    content: message,
  });

  // Check if it's a command
  const isCommand =
    message.startsWith("$") || message.startsWith("/run ");
  if (isCommand) {
    const command = message.startsWith("$")
      ? message.slice(1).trim()
      : message.slice(5).trim();

    // Store command message
    await db.insert(consoleMessages).values({
      agentId,
      role: "command",
      content: command,
    });

    // Create remediation entry
    const [entry] = await db
      .insert(remediationLog)
      .values({ agentId, command })
      .returning();

    res.json({
      type: "command",
      remediationId: entry.id,
      message: "Command queued",
    });
    return;
  }

  // Chat message for AI
  if (!client) {
    res.json({
      type: "chat",
      message: "AI unavailable — ANTHROPIC_API_KEY not configured",
      model: null,
    });
    return;
  }

  // Fetch context
  const [latestSnapshot] = await db
    .select()
    .from(machineSnapshots)
    .where(eq(machineSnapshots.agentId, agentId))
    .orderBy(desc(machineSnapshots.timestamp))
    .limit(1);

  const recentMessages = await db
    .select()
    .from(consoleMessages)
    .where(eq(consoleMessages.agentId, agentId))
    .orderBy(desc(consoleMessages.createdAt))
    .limit(20);

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  const kbEntries = agent
    ? await db
        .select()
        .from(knowledgeBase)
        .where(eq(knowledgeBase.platform, agent.platform))
    : [];

  const systemPrompt =
    "You are an AI assistant helping troubleshoot a Linux machine. You can see the machine's current state. When you identify a solution, respond with a JSON block like ```solution\n{\"pattern\":\"...\",\"command\":\"...\",\"description\":\"...\"}\n``` to document it in the knowledge base. Suggest specific commands when relevant. Be concise.";

  const conversationContext = recentMessages
    .reverse()
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n");

  const userContent = `## Machine State
${latestSnapshot ? JSON.stringify({ cpu: latestSnapshot.cpu, memory: latestSnapshot.memory, disk: latestSnapshot.disk, services: latestSnapshot.services }, null, 2) : "No snapshot available"}

## Knowledge Base
${kbEntries.map((k) => `- ${k.issuePattern}: ${k.solution}`).join("\n") || "Empty"}

## Conversation History
${conversationContext}

## User Message
${message}`;

  let model = HAIKU_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  let aiText =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Escalate if AI seems uncertain
  if (
    aiText.toLowerCase().includes("i'm not sure") ||
    aiText.toLowerCase().includes("i cannot determine") ||
    aiText.toLowerCase().includes("need more information")
  ) {
    model = SONNET_MODEL;
    console.log(`[console] Escalating to ${model}`);
    const escalatedResponse = await client.messages.create({
      model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `ESCALATED: A preliminary analysis was uncertain. Provide a deeper, more thorough analysis.\n\n${userContent}`,
        },
      ],
    });
    aiText =
      escalatedResponse.content[0].type === "text"
        ? escalatedResponse.content[0].text
        : "";
  }

  console.log(`[console] Analysis by ${model}`);

  // Store AI response
  await db.insert(consoleMessages).values({
    agentId,
    role: "assistant",
    content: aiText,
    model,
  });

  // Check for ```solution block and create KB entry
  const solutionMatch = aiText.match(
    /```solution\n([\s\S]*?)\n```/
  );
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
    } catch {
      // Ignore parse errors for solution blocks
    }
  }

  res.json({ type: "chat", message: aiText, model });
});

// POST /:agentId/command-output - agent reports command output
router.post("/:agentId/command-output", agentAuth, async (req, res) => {
  const agentId = req.params.agentId as string;
  const { remediationId, output, success } = req.body;

  if (!remediationId || output === undefined) {
    res.status(400).json({ error: "remediationId and output are required" });
    return;
  }

  // Store output message
  await db.insert(consoleMessages).values({
    agentId,
    role: "output",
    content: output,
    remediationId,
  });

  // Update remediation log
  await db
    .update(remediationLog)
    .set({ result: output, success, executedAt: new Date() })
    .where(eq(remediationLog.id, remediationId));

  // Ask AI to analyze the output
  if (!client) {
    res.json({ ok: true });
    return;
  }

  const systemPrompt =
    "You are an AI assistant helping troubleshoot a Linux machine. Analyze this command output and provide a brief assessment. Be concise.";

  // Get the command that was run
  const [remediation] = await db
    .select()
    .from(remediationLog)
    .where(eq(remediationLog.id, remediationId))
    .limit(1);

  let model = HAIKU_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: 1000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Command: ${remediation?.command ?? "unknown"}\nSuccess: ${success}\nOutput:\n${output}`,
      },
    ],
  });

  const aiText =
    response.content[0].type === "text" ? response.content[0].text : "";

  console.log(`[console] Command analysis by ${model}`);

  await db.insert(consoleMessages).values({
    agentId,
    role: "assistant",
    content: aiText,
    model,
  });

  res.json({ ok: true, analysis: aiText, model });
});

export default router;
