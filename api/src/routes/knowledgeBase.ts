import { Router } from "express";
import { db } from "../db/index.js";
import { knowledgeBase, remediationLog } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

const router = Router();

// List all KB entries
router.get("/", async (_req, res) => {
  const entries = await db
    .select()
    .from(knowledgeBase)
    .orderBy(desc(knowledgeBase.updatedAt));
  res.json(entries);
});

// Get single KB entry
router.get("/:id", async (req, res) => {
  const [entry] = await db
    .select()
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, req.params.id))
    .limit(1);

  if (!entry) {
    res.status(404).json({ error: "Knowledge base entry not found" });
    return;
  }
  res.json(entry);
});

// Create KB entry manually
router.post("/", async (req, res) => {
  const { issuePattern, issueCategory, platform, solution, description, autoApply } =
    req.body;

  if (!issuePattern || !issueCategory || !solution) {
    res.status(400).json({
      error: "issuePattern, issueCategory, and solution are required",
    });
    return;
  }

  const [entry] = await db
    .insert(knowledgeBase)
    .values({
      issuePattern,
      issueCategory,
      platform: platform ?? "linux",
      solution,
      description,
      autoApply: autoApply ?? false,
    })
    .returning();

  res.status(201).json(entry);
});

// Update KB entry
router.patch("/:id", async (req, res) => {
  const { issuePattern, issueCategory, solution, description, autoApply, platform } =
    req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (issuePattern !== undefined) updates.issuePattern = issuePattern;
  if (issueCategory !== undefined) updates.issueCategory = issueCategory;
  if (solution !== undefined) updates.solution = solution;
  if (description !== undefined) updates.description = description;
  if (autoApply !== undefined) updates.autoApply = autoApply;
  if (platform !== undefined) updates.platform = platform;

  const [updated] = await db
    .update(knowledgeBase)
    .set(updates)
    .where(eq(knowledgeBase.id, req.params.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Knowledge base entry not found" });
    return;
  }
  res.json(updated);
});

// Delete KB entry
router.delete("/:id", async (req, res) => {
  const [deleted] = await db
    .delete(knowledgeBase)
    .where(eq(knowledgeBase.id, req.params.id))
    .returning({ id: knowledgeBase.id });

  if (!deleted) {
    res.status(404).json({ error: "Knowledge base entry not found" });
    return;
  }
  res.json({ deleted: true });
});

// Get remediation history for a KB entry
router.get("/:id/history", async (req, res) => {
  const history = await db
    .select()
    .from(remediationLog)
    .where(eq(remediationLog.kbEntryId, req.params.id))
    .orderBy(desc(remediationLog.executedAt));
  res.json(history);
});

export default router;
