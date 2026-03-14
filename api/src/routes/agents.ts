import { Router } from "express";
import { randomBytes } from "crypto";
import { db } from "../db/index.js";
import { agents } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { hashApiKey } from "../middleware/agentAuth.js";
import { registerAgentSchema } from "../types/snapshot.js";

const router = Router();

// Register a new agent — returns the API key (shown only once)
router.post("/register", async (req, res) => {
  try {
    const body = registerAgentSchema.parse(req.body);
    const rawKey = `ars_${randomBytes(32).toString("hex")}`;
    const keyHash = hashApiKey(rawKey);

    const [agent] = await db
      .insert(agents)
      .values({
        name: body.name,
        hostname: body.hostname,
        os: body.os,
        arch: body.arch,
        platform: body.platform,
        apiKeyHash: keyHash,
      })
      .returning();

    res.status(201).json({
      id: agent.id,
      name: agent.name,
      apiKey: rawKey,
      message:
        "Save this API key — it will not be shown again.",
    });
  } catch (err: any) {
    if (err.name === "ZodError") {
      res.status(400).json({ error: "Invalid payload", details: err.errors });
      return;
    }
    throw err;
  }
});

// List all agents
router.get("/", async (_req, res) => {
  const allAgents = await db
    .select({
      id: agents.id,
      name: agents.name,
      hostname: agents.hostname,
      os: agents.os,
      arch: agents.arch,
      platform: agents.platform,
      status: agents.status,
      lastSeen: agents.lastSeen,
      autoRemediate: agents.autoRemediate,
      snapshotInterval: agents.snapshotInterval,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .orderBy(agents.name);

  res.json(allAgents);
});

// Get single agent
router.get("/:id", async (req, res) => {
  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      hostname: agents.hostname,
      os: agents.os,
      arch: agents.arch,
      platform: agents.platform,
      status: agents.status,
      lastSeen: agents.lastSeen,
      autoRemediate: agents.autoRemediate,
      snapshotInterval: agents.snapshotInterval,
      createdAt: agents.createdAt,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .where(eq(agents.id, req.params.id))
    .limit(1);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(agent);
});

// Update agent settings
router.patch("/:id", async (req, res) => {
  const { name, autoRemediate, autoUpdate, snapshotInterval } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (autoRemediate !== undefined) updates.autoRemediate = autoRemediate;
  if (autoUpdate !== undefined) updates.autoUpdate = autoUpdate;
  if (snapshotInterval !== undefined) updates.snapshotInterval = snapshotInterval;

  const [updated] = await db
    .update(agents)
    .set(updates)
    .where(eq(agents.id, req.params.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(updated);
});

// Delete agent
router.delete("/:id", async (req, res) => {
  const [deleted] = await db
    .delete(agents)
    .where(eq(agents.id, req.params.id))
    .returning({ id: agents.id });

  if (!deleted) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json({ deleted: true, id: deleted.id });
});

export default router;
