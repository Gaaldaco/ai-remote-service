import { Router } from "express";
import { db } from "../db/index.js";
import { knowledgeBase, remediationLog } from "../db/schema.js";
import { eq, desc, and, or, ne } from "drizzle-orm";

const router = Router();

// ─── Similarity check ───────────────────────────────────────────────────────
// Word-overlap based similarity for dedup and trend detection

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "at", "on", "in", "to", "of", "and", "or", "for",
  "was", "not", "has", "had", "are", "but", "its", "with", "from", "this",
]);

function getSignificantWords(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function similarity(a: string, b: string): number {
  const wordsA = getSignificantWords(a);
  const wordsB = getSignificantWords(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const overlap = wordsA.filter((w) =>
    wordsB.some((bw) => bw.includes(w) || w.includes(bw))
  ).length;

  // Jaccard-like: overlap / union
  const union = new Set([...wordsA, ...wordsB]).size;
  return overlap / union;
}

function isDuplicate(
  newPattern: string,
  newSolution: string,
  existing: { issuePattern: string; solution: string }
): boolean {
  const patternSim = similarity(newPattern, existing.issuePattern);
  const solutionSim = similarity(newSolution, existing.solution);
  // Very similar pattern AND solution = duplicate
  return patternSim >= 0.6 && solutionSim >= 0.5;
}

function isSimilarPattern(
  newPattern: string,
  existing: { issuePattern: string }
): boolean {
  return similarity(newPattern, existing.issuePattern) >= 0.5;
}

// ─── Trend analysis: promote to global if similar KBs exist across devices ──

async function analyzeAndPromoteToGlobal(newEntry: {
  id: string;
  agentId: string | null;
  issuePattern: string;
  issueCategory: string;
  solution: string;
  solutionSteps: unknown;
  platform: string;
  scope: string;
}) {
  if (newEntry.scope === "global" || !newEntry.agentId) return; // already global

  // Find KB entries for OTHER agents with similar patterns
  const allEntries = await db
    .select()
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.platform, newEntry.platform),
        eq(knowledgeBase.scope, "device"),
        ne(knowledgeBase.id, newEntry.id)
      )
    );

  // Find entries from different agents that match this pattern
  const similarFromOtherDevices = allEntries.filter(
    (e) =>
      e.agentId !== newEntry.agentId &&
      isSimilarPattern(newEntry.issuePattern, e)
  );

  if (similarFromOtherDevices.length > 0) {
    // At least 1 other device has the same issue pattern — create a global KB
    // Check if a global one already exists for this pattern
    const existingGlobals = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.scope, "global"));

    const alreadyGlobal = existingGlobals.some(
      (g) => isSimilarPattern(newEntry.issuePattern, g)
    );

    if (!alreadyGlobal) {
      const deviceCount = new Set(similarFromOtherDevices.map((e) => e.agentId)).size + 1;
      const [globalEntry] = await db
        .insert(knowledgeBase)
        .values({
          agentId: null,
          scope: "global",
          issuePattern: newEntry.issuePattern,
          issueCategory: newEntry.issueCategory,
          platform: newEntry.platform,
          solution: newEntry.solution,
          solutionSteps: newEntry.solutionSteps,
          description: `Auto-promoted: same issue seen on ${deviceCount} devices`,
          autoApply: false, // global entries default to manual approval
        })
        .returning();

      console.log(
        `[kb] Promoted "${newEntry.issuePattern}" to global KB (seen on ${deviceCount} devices) → ${globalEntry.id}`
      );
    }
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// List KB entries — optionally filter by agentId
router.get("/", async (req, res) => {
  const agentId = req.query.agentId as string | undefined;

  let entries;
  if (agentId) {
    // Device-specific + global entries
    entries = await db
      .select()
      .from(knowledgeBase)
      .where(
        or(
          eq(knowledgeBase.agentId, agentId),
          eq(knowledgeBase.scope, "global")
        )
      )
      .orderBy(desc(knowledgeBase.updatedAt));
  } else {
    entries = await db
      .select()
      .from(knowledgeBase)
      .orderBy(desc(knowledgeBase.updatedAt));
  }
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

// Create KB entry — with dedup check
router.post("/", async (req, res) => {
  const {
    issuePattern, issueCategory, platform, solution, description,
    autoApply, agentId, solutionSteps,
  } = req.body;

  if (!issuePattern || !issueCategory || !solution) {
    res.status(400).json({
      error: "issuePattern, issueCategory, and solution are required",
    });
    return;
  }

  // Dedup check: look for existing entries with the same agent (or global) that match
  const existingEntries = await db
    .select()
    .from(knowledgeBase)
    .where(
      agentId
        ? or(eq(knowledgeBase.agentId, agentId), eq(knowledgeBase.scope, "global"))
        : undefined as any
    );

  const duplicate = existingEntries.find((e) =>
    isDuplicate(issuePattern, solution, e)
  );

  if (duplicate) {
    // Update the existing entry instead of creating a duplicate
    const [updated] = await db
      .update(knowledgeBase)
      .set({
        solution,
        solutionSteps: solutionSteps ?? duplicate.solutionSteps,
        description: description ?? duplicate.description,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeBase.id, duplicate.id))
      .returning();

    console.log(`[kb] Dedup: updated existing KB "${duplicate.issuePattern}" instead of creating duplicate`);
    res.status(200).json({ ...updated, deduplicated: true });
    return;
  }

  const [entry] = await db
    .insert(knowledgeBase)
    .values({
      agentId: agentId ?? null,
      scope: agentId ? "device" : "global",
      issuePattern,
      issueCategory,
      platform: platform ?? "linux",
      solution,
      solutionSteps: solutionSteps ?? null,
      description,
      autoApply: autoApply ?? false,
    })
    .returning();

  // Run trend analysis in background
  analyzeAndPromoteToGlobal(entry).catch((err) =>
    console.error(`[kb] Trend analysis failed:`, err)
  );

  res.status(201).json(entry);
});

// Update KB entry
router.patch("/:id", async (req, res) => {
  const {
    issuePattern, issueCategory, solution, description,
    autoApply, platform, solutionSteps, scope,
  } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (issuePattern !== undefined) updates.issuePattern = issuePattern;
  if (issueCategory !== undefined) updates.issueCategory = issueCategory;
  if (solution !== undefined) updates.solution = solution;
  if (description !== undefined) updates.description = description;
  if (autoApply !== undefined) updates.autoApply = autoApply;
  if (platform !== undefined) updates.platform = platform;
  if (solutionSteps !== undefined) updates.solutionSteps = solutionSteps;
  if (scope !== undefined) updates.scope = scope;

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
