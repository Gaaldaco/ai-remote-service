import { Router } from "express";
import { db } from "../db/index.js";
import { alerts, agents } from "../db/schema.js";
import { eq, desc, and, sql } from "drizzle-orm";

const router = Router();

// List alerts (filterable)
router.get("/", async (req, res) => {
  const { agentId, severity, resolved, limit: rawLimit, offset: rawOffset } = req.query;
  const limit = Math.min(Number(rawLimit) || 50, 200);
  const offset = Number(rawOffset) || 0;

  const conditions = [];
  if (agentId) conditions.push(eq(alerts.agentId, agentId as string));
  if (severity) conditions.push(eq(alerts.severity, severity as any));
  if (resolved !== undefined)
    conditions.push(eq(alerts.resolved, resolved === "true"));

  const rows = await db
    .select({
      alert: alerts,
      agentName: agents.name,
      agentHostname: agents.hostname,
    })
    .from(alerts)
    .leftJoin(agents, eq(alerts.agentId, agents.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(alerts.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(rows);
});

// Bulk resolve alerts
router.patch("/bulk/resolve", async (req, res) => {
  const { ids, agentId, severity, all } = req.body;

  const conditions = [eq(alerts.resolved, false)];
  if (ids && Array.isArray(ids) && ids.length > 0) {
    conditions.push(sql`${alerts.id} = ANY(${ids})`);
  }
  if (agentId) conditions.push(eq(alerts.agentId, agentId));
  if (severity) conditions.push(eq(alerts.severity, severity));

  const updated = await db
    .update(alerts)
    .set({ resolved: true, resolvedAt: new Date(), resolvedBy: "user-bulk" })
    .where(and(...conditions))
    .returning({ id: alerts.id });

  res.json({ resolved: updated.length });
});

// Bulk delete alerts (resolved only, or all with force flag)
router.delete("/bulk", async (req, res) => {
  const { resolved, agentId, all } = req.query;

  const conditions = [];
  if (all !== "true") {
    // Default: only delete resolved alerts
    conditions.push(eq(alerts.resolved, true));
  }
  if (agentId) conditions.push(eq(alerts.agentId, agentId as string));
  if (resolved === "false") {
    // Override to delete unresolved
    conditions.length = 0;
    conditions.push(eq(alerts.resolved, false));
    if (agentId) conditions.push(eq(alerts.agentId, agentId as string));
  }

  const deleted = await db
    .delete(alerts)
    .where(conditions.length ? and(...conditions) : undefined)
    .returning({ id: alerts.id });

  res.json({ deleted: deleted.length });
});

// Alert summary (counts by severity)
router.get("/summary", async (_req, res) => {
  const result = await db
    .select({
      severity: alerts.severity,
      total: sql<number>`count(*)::int`,
      unresolved: sql<number>`count(*) filter (where ${alerts.resolved} = false)::int`,
    })
    .from(alerts)
    .groupBy(alerts.severity);

  const totalUnresolved = result.reduce((sum, r) => sum + r.unresolved, 0);
  res.json({ bySeverity: result, totalUnresolved });
});

// Get single alert
router.get("/:id", async (req, res) => {
  const [alert] = await db
    .select()
    .from(alerts)
    .where(eq(alerts.id, req.params.id))
    .limit(1);

  if (!alert) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  res.json(alert);
});

// Resolve alert
router.patch("/:id/resolve", async (req, res) => {
  const [updated] = await db
    .update(alerts)
    .set({
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy: req.body.resolvedBy ?? "user",
    })
    .where(eq(alerts.id, req.params.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  res.json(updated);
});

export default router;
