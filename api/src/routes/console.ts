import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/index.js";
import {
  consoleMessages,
  consoleSessions,
  remediationLog,
  machineSnapshots,
  knowledgeBase,
  agents,
  alerts,
} from "../db/schema.js";
import { eq, desc, asc, and } from "drizzle-orm";

const router = Router();

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ─── Token estimation ───────────────────────────────────────────────────────
// Rough estimate: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;
const MAX_HISTORY_TOKENS = 6000; // budget for conversation history
const SUMMARIZE_THRESHOLD = 8000; // when session total exceeds this, compress old messages

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ─── Session management ─────────────────────────────────────────────────────

// GET /:agentId/sessions - list sessions for an agent
router.get("/:agentId/sessions", async (req, res) => {
  const agentId = req.params.agentId as string;

  const sessions = await db
    .select()
    .from(consoleSessions)
    .where(eq(consoleSessions.agentId, agentId))
    .orderBy(desc(consoleSessions.lastActiveAt))
    .limit(20);

  res.json(sessions);
});

// POST /:agentId/sessions - create a new session
router.post("/:agentId/sessions", async (req, res) => {
  const agentId = req.params.agentId as string;

  const [session] = await db
    .insert(consoleSessions)
    .values({ agentId })
    .returning();

  res.json(session);
});

// GET /:agentId/messages - conversation history (scoped to session)
router.get("/:agentId/messages", async (req, res) => {
  const agentId = req.params.agentId as string;
  const sessionId = req.query.sessionId as string | undefined;

  let query = db
    .select()
    .from(consoleMessages)
    .where(
      sessionId
        ? and(eq(consoleMessages.agentId, agentId), eq(consoleMessages.sessionId, sessionId))
        : eq(consoleMessages.agentId, agentId)
    )
    .orderBy(asc(consoleMessages.createdAt))
    .limit(200);

  const messages = await query;
  res.json(messages);
});

// POST /:agentId/execute - queue a command for the agent
router.post("/:agentId/execute", async (req, res) => {
  const agentId = req.params.agentId as string;
  const { command, sessionId } = req.body;

  if (!command || typeof command !== "string") {
    res.status(400).json({ error: "command is required" });
    return;
  }

  await db.insert(consoleMessages).values({
    agentId,
    sessionId: sessionId || null,
    role: "command",
    content: command,
  });

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

// POST /:agentId/ask - ask AI about the machine (session-aware)
router.post("/:agentId/ask", async (req, res) => {
  const agentId = req.params.agentId as string;
  const { message, terminalHistory, sessionId, autopilot } = req.body;

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (!client) {
    res.json({ response: "AI unavailable — ANTHROPIC_API_KEY not configured", model: null });
    return;
  }

  // Ensure we have a session
  let activeSessionId = sessionId;
  if (!activeSessionId) {
    const [session] = await db
      .insert(consoleSessions)
      .values({ agentId })
      .returning();
    activeSessionId = session.id;
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

  // Fetch session info (for summary of older context)
  const [session] = await db
    .select()
    .from(consoleSessions)
    .where(eq(consoleSessions.id, activeSessionId))
    .limit(1);

  // Build system prompt with machine state baked in
  const autopilotInstructions = autopilot ? `
## AUTOPILOT MODE — You are driving the terminal to remediate an issue.
Your workflow:
1. Run DIAGNOSTIC commands to understand the root cause (logs, status, process lists)
2. Once you understand the cause, suggest a FIX command (user must approve)
3. After the fix runs, VERIFY it worked with another diagnostic
4. If verified, document the solution AND mark resolved
5. If the process looks like it could be intentional (stress tests, benchmarks, etc), ASK the user before killing it

NEVER run destructive commands: no rm -rf, no dd, no mkfs, no DROP, no reboot, no shutdown, no init 0.

## Command blocks — you MUST use these (one per response):

Diagnostic (auto-runs, read-only):
\`\`\`diagnostic
{"command": "the command", "reason": "what we're checking"}
\`\`\`

Fix (requires user approval):
\`\`\`suggest
{"command": "the fix command", "reason": "how this fixes the issue"}
\`\`\`

When fix is verified working, document it:
\`\`\`solution
{"pattern": "issue description", "command": "fix command", "description": "explanation"}
\`\`\`

When the issue is fully resolved, emit this to close out:
\`\`\`resolved
{"summary": "what was wrong and how it was fixed"}
\`\`\`

IMPORTANT RULES:
- Run ONE command at a time, then wait for the output
- ALWAYS use a code block (diagnostic or suggest) — never just describe a command
- After a fix succeeds, ALWAYS verify with a diagnostic, then emit solution + resolved
- Keep explanations brief (1-2 sentences max between commands)
` : "";

  const systemPrompt = `You are an AI sysadmin assistant connected to a live Linux terminal on "${agent?.hostname ?? "unknown"}".
You have full conversation history for this session. Reference previous messages naturally.
Your job: help the user troubleshoot issues, suggest commands, and document solutions.
${autopilotInstructions}
When suggesting a command to run, wrap it in a special block:
\`\`\`suggest
{"command": "the command to run", "reason": "why this will help"}
\`\`\`

When you want to run a diagnostic that doesn't change anything, use:
\`\`\`diagnostic
{"command": "the read-only command", "reason": "what we're checking"}
\`\`\`

When you've identified a working solution to document, use:
\`\`\`solution
{"pattern": "issue description", "command": "fix command", "description": "explanation"}
\`\`\`

IMPORTANT SAFETY RULES:
- NEVER suggest destructive commands (rm -rf /, dd, mkfs, format, DROP DATABASE, reboot, shutdown, halt, init 0)
- NEVER kill system processes (PID 1, init, systemd, sshd, the ai-remote-agent)
- Private IPs (10.x, 192.168.x) are legitimate admin traffic, not attacks

Be concise and direct. Give one clear suggestion at a time.

## Current Machine State
Host: ${agent?.hostname ?? "unknown"} (${agent?.os ?? "unknown"}, ${agent?.arch ?? "unknown"})
${latestSnapshot ? `CPU: ${(latestSnapshot.cpu as any)?.usagePercent?.toFixed(1)}% | Memory: ${(latestSnapshot.memory as any)?.usagePercent?.toFixed(1)}% | Disk: ${((latestSnapshot.disk as any)?.[0]?.usagePercent ?? 0).toFixed(0)}%` : "No snapshot data"}

## Active Alerts (${unresolvedAlerts.length})
${unresolvedAlerts.map((a) => `- [${a.severity}] ${a.message}`).join("\n") || "None"}

## Known Solutions
${kbEntries.map((k) => `- ${k.issuePattern}: ${k.solution}`).join("\n") || "None"}`;

  // ── Build conversation messages within token budget ──
  // Load session messages (newest first so we can trim from the oldest)
  const sessionMessages = await db
    .select({
      role: consoleMessages.role,
      content: consoleMessages.content,
      tokenEstimate: consoleMessages.tokenEstimate,
    })
    .from(consoleMessages)
    .where(
      and(
        eq(consoleMessages.agentId, agentId),
        eq(consoleMessages.sessionId, activeSessionId)
      )
    )
    .orderBy(desc(consoleMessages.createdAt))
    .limit(50);

  // Reverse to chronological, filter to user/assistant only
  const chronological = sessionMessages.reverse();
  const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  let tokenBudgetUsed = 0;

  // If session has a summary from compressed older messages, we'll prepend it
  const sessionSummary = session?.summary ?? null;

  // Walk through messages newest-to-oldest to stay within budget
  const eligibleMessages = chronological.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  // Build from newest to oldest, then reverse
  const withinBudget: typeof eligibleMessages = [];
  for (let i = eligibleMessages.length - 1; i >= 0; i--) {
    const msg = eligibleMessages[i];
    const tokens = msg.tokenEstimate ?? estimateTokens(msg.content);
    if (tokenBudgetUsed + tokens > MAX_HISTORY_TOKENS) break;
    tokenBudgetUsed += tokens;
    withinBudget.unshift(msg);
  }

  // Ensure alternating roles for Claude API
  for (const msg of withinBudget) {
    const castRole = msg.role as "user" | "assistant";
    const lastRole = conversationMessages.length > 0
      ? conversationMessages[conversationMessages.length - 1].role
      : null;
    if (castRole !== lastRole) {
      conversationMessages.push({ role: castRole, content: msg.content });
    }
  }

  // If we have a session summary and dropped old messages, inject it
  if (sessionSummary && withinBudget.length < eligibleMessages.length) {
    conversationMessages.unshift({
      role: "user",
      content: `[Previous conversation summary: ${sessionSummary}]`,
    });
    // If that makes it start user-user, insert a placeholder assistant
    if (conversationMessages.length > 1 && conversationMessages[1].role === "user") {
      conversationMessages.splice(1, 0, {
        role: "assistant",
        content: "Understood, I have the context from our previous conversation.",
      });
    }
  }

  // Drop trailing user message to avoid double-user with current message
  if (conversationMessages.length > 0 && conversationMessages[conversationMessages.length - 1].role === "user") {
    conversationMessages.pop();
  }

  // Add current user message
  const currentUserMessage = terminalHistory
    ? `## Recent Terminal Output\n${terminalHistory}\n\n${message}`
    : message;

  conversationMessages.push({ role: "user", content: currentUserMessage });

  // Ensure starts with user
  if (conversationMessages.length > 1 && conversationMessages[0].role === "assistant") {
    conversationMessages.shift();
  }

  // ── Call AI ──
  const model = HAIKU_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    system: systemPrompt,
    messages: conversationMessages,
  });

  const aiText = response.content[0].type === "text" ? response.content[0].text : "";
  console.log(`[console] AI response by ${model} (session=${activeSessionId}, history=${conversationMessages.length - 1} msgs, ~${tokenBudgetUsed} tokens)`);

  // ── Save messages to DB ──
  const userTokens = estimateTokens(message);
  const assistantTokens = estimateTokens(aiText);

  await db.insert(consoleMessages).values([
    { agentId, sessionId: activeSessionId, role: "user" as const, content: message, tokenEstimate: userTokens },
    { agentId, sessionId: activeSessionId, role: "assistant" as const, content: aiText, model, tokenEstimate: assistantTokens },
  ]);

  // Update session token estimate and last active
  const newSessionTokens = (session?.tokenEstimate ?? 0) + userTokens + assistantTokens;
  await db
    .update(consoleSessions)
    .set({
      tokenEstimate: newSessionTokens,
      lastActiveAt: new Date(),
    })
    .where(eq(consoleSessions.id, activeSessionId));

  // ── Compress old messages if session is getting large ──
  if (newSessionTokens > SUMMARIZE_THRESHOLD && client) {
    await compressSession(activeSessionId, agentId);
  }

  // ── Parse suggest/solution blocks ──
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

  let suggestion = null;
  const suggestMatch = aiText.match(/```suggest\n([\s\S]*?)\n```/);
  if (suggestMatch) {
    try {
      suggestion = JSON.parse(suggestMatch[1]);
    } catch {
      // ignore
    }
  }

  let diagnostic = null;
  const diagnosticMatch = aiText.match(/```diagnostic\n([\s\S]*?)\n```/);
  if (diagnosticMatch) {
    try {
      diagnostic = JSON.parse(diagnosticMatch[1]);
    } catch {
      // ignore
    }
  }

  let resolved = null;
  const resolvedMatch = aiText.match(/```resolved\n([\s\S]*?)\n```/);
  if (resolvedMatch) {
    try {
      resolved = JSON.parse(resolvedMatch[1]);
    } catch {
      // ignore
    }
  }

  res.json({ response: aiText, model, suggestion, diagnostic, resolved, sessionId: activeSessionId });
});

// ─── Session compression ────────────────────────────────────────────────────
// Summarizes older messages so the session stays within budget

async function compressSession(sessionId: string, agentId: string) {
  if (!client) return;

  // Load all user/assistant messages in this session
  const allMessages = await db
    .select({ id: consoleMessages.id, role: consoleMessages.role, content: consoleMessages.content, createdAt: consoleMessages.createdAt })
    .from(consoleMessages)
    .where(
      and(
        eq(consoleMessages.agentId, agentId),
        eq(consoleMessages.sessionId, sessionId),
        // only user and assistant messages are relevant for AI context
      )
    )
    .orderBy(asc(consoleMessages.createdAt));

  const chatMessages = allMessages.filter((m) => m.role === "user" || m.role === "assistant");

  if (chatMessages.length <= 6) return; // not enough to compress

  // Keep the last 4 messages intact, summarize the rest
  const toSummarize = chatMessages.slice(0, -4);
  const transcript = toSummarize
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  try {
    const summaryResponse = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Summarize this sysadmin troubleshooting conversation into 2-3 sentences. Preserve: what issue was being investigated, what commands were run and their results, what conclusions were reached, and any unresolved questions.\n\n${transcript}`,
        },
      ],
    });

    const summary =
      summaryResponse.content[0].type === "text"
        ? summaryResponse.content[0].text
        : "";

    // Save summary to session
    await db
      .update(consoleSessions)
      .set({ summary })
      .where(eq(consoleSessions.id, sessionId));

    // Delete the summarized messages from DB to save space
    const idsToDelete = toSummarize.map((m) => m.id);
    for (const id of idsToDelete) {
      await db.delete(consoleMessages).where(eq(consoleMessages.id, id));
    }

    // Recalculate session token estimate
    const remaining = await db
      .select({ tokenEstimate: consoleMessages.tokenEstimate })
      .from(consoleMessages)
      .where(
        and(
          eq(consoleMessages.sessionId, sessionId)
        )
      );

    const totalTokens = remaining.reduce((sum, m) => sum + (m.tokenEstimate ?? 0), 0) + estimateTokens(summary);
    await db
      .update(consoleSessions)
      .set({ tokenEstimate: totalTokens })
      .where(eq(consoleSessions.id, sessionId));

    console.log(
      `[console] Compressed session ${sessionId}: summarized ${idsToDelete.length} messages, ~${totalTokens} tokens remaining`
    );
  } catch (err) {
    console.error(`[console] Session compression failed:`, err);
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

// DELETE /:agentId/sessions/:sessionId - delete a specific session and its messages
router.delete("/:agentId/sessions/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId as string;

  await db.delete(consoleMessages).where(eq(consoleMessages.sessionId, sessionId));
  await db.delete(consoleSessions).where(eq(consoleSessions.id, sessionId));

  res.json({ deleted: true });
});

// DELETE /:agentId/sessions - clear all sessions for an agent
router.delete("/:agentId/sessions", async (req, res) => {
  const agentId = req.params.agentId as string;

  // Get all session IDs first
  const agentSessions = await db
    .select({ id: consoleSessions.id })
    .from(consoleSessions)
    .where(eq(consoleSessions.agentId, agentId));

  for (const s of agentSessions) {
    await db.delete(consoleMessages).where(eq(consoleMessages.sessionId, s.id));
  }
  await db.delete(consoleSessions).where(eq(consoleSessions.agentId, agentId));

  // Also clear any orphaned messages without a session
  await db.delete(consoleMessages).where(eq(consoleMessages.agentId, agentId));

  res.json({ deleted: true, count: agentSessions.length });
});

// ─── Auto-purge old sessions ────────────────────────────────────────────────
// Called on a timer from index.ts — deletes sessions older than 24h

export async function purgeOldSessions() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Load all sessions and filter expired ones in JS
  const allSessions = await db.select().from(consoleSessions);
  const expired = allSessions.filter((s) => new Date(s.lastActiveAt) < cutoff);

  if (expired.length === 0) return;

  for (const session of expired) {
    await db.delete(consoleMessages).where(eq(consoleMessages.sessionId, session.id));
    await db.delete(consoleSessions).where(eq(consoleSessions.id, session.id));
  }

  console.log(`[console] Purged ${expired.length} expired session(s)`);
}

export default router;
