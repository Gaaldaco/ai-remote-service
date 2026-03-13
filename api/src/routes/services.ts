import { Router } from "express";
import { db } from "../db/index.js";
import { monitoredServices, machineSnapshots } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// Get all services from latest snapshot for an agent
router.get("/:agentId/all", async (req, res) => {
  const [latest] = await db
    .select({ services: machineSnapshots.services })
    .from(machineSnapshots)
    .where(eq(machineSnapshots.agentId, req.params.agentId))
    .orderBy(desc(machineSnapshots.timestamp))
    .limit(1);

  if (!latest) {
    res.json([]);
    return;
  }
  res.json(latest.services ?? []);
});

// Get monitored (pinned) services for an agent
router.get("/:agentId/monitored", async (req, res) => {
  const monitored = await db
    .select()
    .from(monitoredServices)
    .where(eq(monitoredServices.agentId, req.params.agentId))
    .orderBy(monitoredServices.serviceName);

  res.json(monitored);
});

// Pin a service for monitoring
router.post("/:agentId/monitor", async (req, res) => {
  const { serviceName, alertOnDown, alertOnHighCpu, cpuThreshold } = req.body;

  if (!serviceName) {
    res.status(400).json({ error: "serviceName is required" });
    return;
  }

  // Check if already monitored
  const [existing] = await db
    .select()
    .from(monitoredServices)
    .where(
      and(
        eq(monitoredServices.agentId, req.params.agentId),
        eq(monitoredServices.serviceName, serviceName)
      )
    )
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "Service is already monitored" });
    return;
  }

  const [created] = await db
    .insert(monitoredServices)
    .values({
      agentId: req.params.agentId,
      serviceName,
      alertOnDown: alertOnDown ?? true,
      alertOnHighCpu: alertOnHighCpu ?? false,
      cpuThreshold: cpuThreshold ?? 90,
    })
    .returning();

  res.status(201).json(created);
});

// Update monitoring config
router.patch("/:agentId/monitor/:serviceId", async (req, res) => {
  const { enabled, alertOnDown, alertOnHighCpu, cpuThreshold } = req.body;
  const updates: Record<string, unknown> = {};
  if (enabled !== undefined) updates.enabled = enabled;
  if (alertOnDown !== undefined) updates.alertOnDown = alertOnDown;
  if (alertOnHighCpu !== undefined) updates.alertOnHighCpu = alertOnHighCpu;
  if (cpuThreshold !== undefined) updates.cpuThreshold = cpuThreshold;

  const [updated] = await db
    .update(monitoredServices)
    .set(updates)
    .where(eq(monitoredServices.id, req.params.serviceId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Monitored service not found" });
    return;
  }
  res.json(updated);
});

// Unpin a service
router.delete("/:agentId/monitor/:serviceId", async (req, res) => {
  const [deleted] = await db
    .delete(monitoredServices)
    .where(eq(monitoredServices.id, req.params.serviceId))
    .returning({ id: monitoredServices.id });

  if (!deleted) {
    res.status(404).json({ error: "Monitored service not found" });
    return;
  }
  res.json({ deleted: true });
});

export default router;
