import { Router } from "express";
import { db } from "../db/index.js";
import { machineSnapshots, agents } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { agentAuth } from "../middleware/agentAuth.js";
import { snapshotPayloadSchema } from "../types/snapshot.js";
import { snapshotQueue } from "../lib/queue.js";
import { setRedis } from "../lib/redis.js";

const router = Router();

// Agent submits a snapshot (authenticated)
router.post("/", agentAuth, async (req, res) => {
  try {
    const agent = (req as any).agent;
    const body = snapshotPayloadSchema.parse(req.body);

    const [snapshot] = await db
      .insert(machineSnapshots)
      .values({
        agentId: agent.id,
        cpu: body.cpu,
        memory: body.memory,
        disk: body.disk,
        network: body.network ?? [],
        processes: body.processes,
        openPorts: body.openPorts ?? [],
        users: body.users ?? [],
        authLogs: body.authLogs ?? [],
        pendingUpdates: body.pendingUpdates ?? [],
        services: body.services,
      })
      .returning();

    // Update agent status and last seen
    await db
      .update(agents)
      .set({
        status: "online",
        lastSeen: new Date(),
        hostname: body.hostname,
        os: body.os,
        arch: body.arch,
        platform: body.platform,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agent.id));

    // Store heartbeat in Redis (90s TTL)
    await setRedis(`heartbeat:${agent.id}`, { lastSeen: Date.now() }, 90);

    // Queue for AI analysis
    await snapshotQueue.add("analyze", {
      snapshotId: snapshot.id,
      agentId: agent.id,
    });

    res.status(201).json({ received: true, snapshotId: snapshot.id });
  } catch (err: any) {
    if (err.name === "ZodError") {
      res.status(400).json({ error: "Invalid snapshot payload", details: err.errors });
      return;
    }
    throw err;
  }
});

// Agent heartbeat (lightweight)
router.post("/heartbeat", agentAuth, async (req, res) => {
  const agent = (req as any).agent;
  await db
    .update(agents)
    .set({ status: "online", lastSeen: new Date(), updatedAt: new Date() })
    .where(eq(agents.id, agent.id));
  await setRedis(`heartbeat:${agent.id}`, { lastSeen: Date.now() }, 90);
  res.json({ ok: true });
});

// Get snapshots for an agent (paginated)
router.get("/agent/:agentId", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const snapshots = await db
    .select()
    .from(machineSnapshots)
    .where(eq(machineSnapshots.agentId, req.params.agentId))
    .orderBy(desc(machineSnapshots.timestamp))
    .limit(limit)
    .offset(offset);

  res.json(snapshots);
});

// Get single snapshot
router.get("/:id", async (req, res) => {
  const [snapshot] = await db
    .select()
    .from(machineSnapshots)
    .where(eq(machineSnapshots.id, req.params.id))
    .limit(1);

  if (!snapshot) {
    res.status(404).json({ error: "Snapshot not found" });
    return;
  }
  res.json(snapshot);
});

export default router;
