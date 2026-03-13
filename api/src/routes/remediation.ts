import { Router } from "express";
import { db } from "../db/index.js";
import {
  remediationLog,
  alerts,
  knowledgeBase,
  agents,
} from "../db/schema.js";
import { eq, desc, and, isNull } from "drizzle-orm";
import { agentAuth } from "../middleware/agentAuth.js";
import { commandResultSchema } from "../types/snapshot.js";

const router = Router();

// Agent polls for pending commands
router.get("/commands", agentAuth, async (req, res) => {
  const agent = (req as any).agent;

  const pending = await db
    .select()
    .from(remediationLog)
    .where(
      and(
        eq(remediationLog.agentId, agent.id),
        isNull(remediationLog.success) // not yet executed
      )
    )
    .orderBy(remediationLog.executedAt)
    .limit(10);

  res.json(
    pending.map((r) => ({
      id: r.id,
      command: r.command,
      alertId: r.alertId,
      kbEntryId: r.kbEntryId,
    }))
  );
});

// Agent reports command result
router.post("/:id/result", agentAuth, async (req, res) => {
  try {
    const result = commandResultSchema.parse(req.body);

    const remediationId = req.params.id as string;
    const [updated] = await db
      .update(remediationLog)
      .set({
        result: result.output,
        success: result.success,
        executedAt: new Date(),
      })
      .where(eq(remediationLog.id, remediationId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Remediation entry not found" });
      return;
    }

    // Update knowledge base success/failure counts
    if (updated.kbEntryId) {
      if (result.success) {
        await db
          .update(knowledgeBase)
          .set({
            successCount: (
              await db
                .select({ c: knowledgeBase.successCount })
                .from(knowledgeBase)
                .where(eq(knowledgeBase.id, updated.kbEntryId))
            )[0].c + 1,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeBase.id, updated.kbEntryId));
      } else {
        await db
          .update(knowledgeBase)
          .set({
            failureCount: (
              await db
                .select({ c: knowledgeBase.failureCount })
                .from(knowledgeBase)
                .where(eq(knowledgeBase.id, updated.kbEntryId))
            )[0].c + 1,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeBase.id, updated.kbEntryId));
      }
    }

    // Resolve the alert if remediation succeeded
    if (result.success && updated.alertId) {
      await db
        .update(alerts)
        .set({
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy: "auto",
        })
        .where(eq(alerts.id, updated.alertId));
    }

    res.json({ ok: true, success: result.success });
  } catch (err: any) {
    if (err.name === "ZodError") {
      res.status(400).json({ error: "Invalid result payload", details: err.errors });
      return;
    }
    throw err;
  }
});

// Manually trigger a command on an agent
router.post("/manual", async (req, res) => {
  const { agentId, command, alertId } = req.body;

  if (!agentId || !command) {
    res.status(400).json({ error: "agentId and command are required" });
    return;
  }

  // Verify agent exists
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const [entry] = await db
    .insert(remediationLog)
    .values({
      agentId,
      command,
      alertId: alertId ?? null,
    })
    .returning();

  res.status(201).json(entry);
});

// Get remediation log (paginated)
router.get("/log", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const agentId = req.query.agentId as string | undefined;

  const conditions = [];
  if (agentId) conditions.push(eq(remediationLog.agentId, agentId));

  const rows = await db
    .select()
    .from(remediationLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(remediationLog.executedAt))
    .limit(limit)
    .offset(offset);

  res.json(rows);
});

export default router;
