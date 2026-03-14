import "dotenv/config";
import { Worker } from "bullmq";
import { db } from "../db/index.js";
import {
  machineSnapshots,
  agents,
  monitoredServices,
  knowledgeBase,
  alerts,
  remediationLog,
} from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { analyzeWithAI } from "../lib/claude.js";

const redisUrl =
  process.env.REDIS_URL || "redis://redis.railway.internal:6379";

const connection = { url: redisUrl };

// ─── Thresholds (rule-based, no AI needed) ──────────────────────────────────

const THRESHOLDS = {
  cpu: { warning: 80, critical: 95 },
  memory: { warning: 85, critical: 95 },
  disk: { warning: 85, critical: 95 },
  authFailures: { warning: 5, critical: 20 }, // per snapshot window
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface Issue {
  category: string;
  severity: "info" | "warning" | "critical";
  description: string;
  suggestedCommand: string | null;
  matchesKnownPattern: string | null;
}

interface AnalysisResult {
  healthScore: number;
  summary: string;
  issues: Issue[];
  usedAI: boolean;
}

// ─── Rule-based analysis (free, instant) ────────────────────────────────────

function analyzeLocally(
  snapshot: Record<string, any>,
  hostname: string,
  monitored: Array<{ serviceName: string }>,
  kbEntries: Array<{ id: string; issuePattern: string; solution: string; successCount: number; failureCount: number }>
): AnalysisResult {
  const issues: Issue[] = [];
  let healthScore = 100;

  // ── CPU ──
  const cpuUsage = snapshot.cpu?.usagePercent ?? 0;
  if (cpuUsage >= THRESHOLDS.cpu.critical) {
    issues.push({
      category: "performance",
      severity: "critical",
      description: `CPU usage critically high at ${cpuUsage.toFixed(1)}%`,
      suggestedCommand: "top -b -n 1 -o %CPU | head -20",
      matchesKnownPattern: findKbMatch("high cpu", kbEntries),
    });
    healthScore -= 30;
  } else if (cpuUsage >= THRESHOLDS.cpu.warning) {
    issues.push({
      category: "performance",
      severity: "warning",
      description: `CPU usage elevated at ${cpuUsage.toFixed(1)}%`,
      suggestedCommand: "top -b -n 1 -o %CPU | head -20",
      matchesKnownPattern: findKbMatch("high cpu", kbEntries),
    });
    healthScore -= 10;
  }

  // ── Memory ──
  const memUsage = snapshot.memory?.usagePercent ?? 0;
  if (memUsage >= THRESHOLDS.memory.critical) {
    issues.push({
      category: "performance",
      severity: "critical",
      description: `Memory usage critically high at ${memUsage.toFixed(1)}%`,
      suggestedCommand: "ps aux --sort=-%mem | head -15",
      matchesKnownPattern: findKbMatch("high memory", kbEntries),
    });
    healthScore -= 30;
  } else if (memUsage >= THRESHOLDS.memory.warning) {
    issues.push({
      category: "performance",
      severity: "warning",
      description: `Memory usage elevated at ${memUsage.toFixed(1)}%`,
      suggestedCommand: "ps aux --sort=-%mem | head -15",
      matchesKnownPattern: findKbMatch("high memory", kbEntries),
    });
    healthScore -= 10;
  }

  // ── Disk ──
  const disks = (snapshot.disk as any[]) ?? [];
  for (const d of disks) {
    const usage = d.usagePercent ?? 0;
    if (usage >= THRESHOLDS.disk.critical) {
      issues.push({
        category: "performance",
        severity: "critical",
        description: `Disk ${d.mountpoint} critically full at ${usage.toFixed(0)}%`,
        suggestedCommand: `du -sh ${d.mountpoint}/* 2>/dev/null | sort -rh | head -10`,
        matchesKnownPattern: findKbMatch("high disk", kbEntries),
      });
      healthScore -= 25;
    } else if (usage >= THRESHOLDS.disk.warning) {
      issues.push({
        category: "performance",
        severity: "warning",
        description: `Disk ${d.mountpoint} usage elevated at ${usage.toFixed(0)}%`,
        suggestedCommand: `du -sh ${d.mountpoint}/* 2>/dev/null | sort -rh | head -10`,
        matchesKnownPattern: findKbMatch("high disk", kbEntries),
      });
      healthScore -= 5;
    }
  }

  // ── Auth failures (exclude private/local IPs — those are legitimate admin access) ──
  const authLogs = (snapshot.authLogs as any[]) ?? [];
  const failures = authLogs.filter(
    (l: any) => l.success === false && !isPrivateIP(l.source)
  );
  if (failures.length >= THRESHOLDS.authFailures.critical) {
    issues.push({
      category: "security",
      severity: "critical",
      description: `${failures.length} authentication failures detected`,
      suggestedCommand: "journalctl -u sshd --since '1 hour ago' --no-pager | tail -30",
      matchesKnownPattern: findKbMatch("auth failure", kbEntries),
    });
    healthScore -= 20;
  } else if (failures.length >= THRESHOLDS.authFailures.warning) {
    issues.push({
      category: "security",
      severity: "warning",
      description: `${failures.length} authentication failures detected`,
      suggestedCommand: "journalctl -u sshd --since '1 hour ago' --no-pager | tail -30",
      matchesKnownPattern: findKbMatch("auth failure", kbEntries),
    });
    healthScore -= 5;
  }

  // ── Pending security updates ──
  const updates = (snapshot.pendingUpdates as any[]) ?? [];
  if (updates.length > 0) {
    issues.push({
      category: "update",
      severity: updates.length > 10 ? "warning" : "info",
      description: `${updates.length} pending package update(s)`,
      suggestedCommand: null,
      matchesKnownPattern: null,
    });
    if (updates.length > 10) healthScore -= 5;
  }

  // ── Monitored services ──
  const services = (snapshot.services as any[]) ?? [];
  const serviceIssues: Issue[] = [];
  for (const mon of monitored) {
    const svc = services.find((s: any) => s.name === mon.serviceName);
    if (!svc || svc.status === "failed" || svc.status === "stopped" || svc.status === "dead") {
      serviceIssues.push({
        category: "availability",
        severity: "critical",
        description: `Monitored service "${mon.serviceName}" is ${svc?.status ?? "not found"} on ${hostname}`,
        suggestedCommand: `systemctl restart ${mon.serviceName}`,
        matchesKnownPattern: findKbMatch(mon.serviceName, kbEntries),
      });
      healthScore -= 20;
    }
  }
  issues.push(...serviceIssues);

  healthScore = Math.max(0, healthScore);

  const summaryParts: string[] = [];
  if (issues.length === 0) {
    summaryParts.push("All systems nominal.");
  } else {
    const crits = issues.filter((i) => i.severity === "critical").length;
    const warns = issues.filter((i) => i.severity === "warning").length;
    if (crits > 0) summaryParts.push(`${crits} critical issue(s)`);
    if (warns > 0) summaryParts.push(`${warns} warning(s)`);
    summaryParts.push(`Health score: ${healthScore}/100`);
  }

  return {
    healthScore,
    summary: summaryParts.join(". ") + ".",
    issues,
    usedAI: false,
  };
}

function isPrivateIP(ip: string | undefined | null): boolean {
  if (!ip) return false;
  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") || ip.startsWith("172.2") || ip.startsWith("172.30.") ||
    ip.startsWith("172.31.") ||
    ip === "127.0.0.1" || ip === "::1" || ip === "localhost"
  );
}

function findKbMatch(
  pattern: string,
  kbEntries: Array<{ id: string; issuePattern: string }>
): string | null {
  const lower = pattern.toLowerCase();
  const match = kbEntries.find((k) =>
    k.issuePattern.toLowerCase().includes(lower) ||
    lower.includes(k.issuePattern.toLowerCase())
  );
  return match?.id ?? null;
}

// ─── Worker ─────────────────────────────────────────────────────────────────

console.log("[worker] Starting snapshot analysis worker...");

const worker = new Worker(
  "snapshot-analysis",
  async (job) => {
    const { snapshotId, agentId } = job.data;
    console.log(`[worker] Analyzing snapshot ${snapshotId} for agent ${agentId}`);

    // 1. Fetch snapshot
    const [snapshot] = await db
      .select()
      .from(machineSnapshots)
      .where(eq(machineSnapshots.id, snapshotId))
      .limit(1);

    if (!snapshot) {
      console.warn(`[worker] Snapshot ${snapshotId} not found, skipping`);
      return;
    }

    // 2. Fetch agent info
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!agent) {
      console.warn(`[worker] Agent ${agentId} not found, skipping`);
      return;
    }

    // 3. Fetch monitored services
    const monitored = await db
      .select({ serviceName: monitoredServices.serviceName })
      .from(monitoredServices)
      .where(eq(monitoredServices.agentId, agentId));

    // 4. Fetch knowledge base entries for this platform
    const kbEntries = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.platform, agent.platform));

    const kbMapped = kbEntries.map((k) => ({
      id: k.id,
      issuePattern: k.issuePattern,
      solution: k.solution,
      successCount: k.successCount,
      failureCount: k.failureCount,
    }));

    // 5. Rule-based analysis first (free, instant)
    const snapshotData = {
      cpu: snapshot.cpu,
      memory: snapshot.memory,
      disk: snapshot.disk,
      network: snapshot.network,
      processes: snapshot.processes,
      openPorts: snapshot.openPorts,
      users: snapshot.users,
      authLogs: snapshot.authLogs,
      pendingUpdates: snapshot.pendingUpdates,
      services: snapshot.services,
    };

    const analysis = analyzeLocally(snapshotData, agent.hostname, monitored, kbMapped);

    // 6. Only call AI for monitored service failures — CPU/memory/disk criticals
    //    are fully handled by rule-based analysis and don't need AI tokens
    const hasServiceDown = analysis.issues.some(
      (i) => i.category === "availability" && i.severity === "critical"
    );

    if (hasServiceDown) {
      console.log(
        `[worker] Monitored service failure detected — escalating to AI for root-cause analysis`
      );

      try {
        const aiResult = await analyzeWithAI(
          agent.name,
          agent.hostname,
          agent.os,
          snapshotData,
          monitored,
          kbMapped,
          analysis // pass local analysis so AI has context on what was already found
        );

        if (aiResult) {
          // Merge: AI overrides health score and summary, combine issues
          analysis.healthScore = aiResult.healthScore;
          analysis.summary = aiResult.summary;
          analysis.usedAI = true;

          // Add any AI-found issues that aren't duplicates of local ones
          for (const aiIssue of aiResult.issues) {
            const isDuplicate = analysis.issues.some(
              (local) =>
                local.category === aiIssue.category &&
                local.description === aiIssue.description
            );
            if (!isDuplicate) {
              analysis.issues.push(aiIssue);
            }
          }
        }
      } catch (err) {
        console.error(`[worker] AI analysis failed, using local results:`, err);
      }
    } else {
      console.log(
        `[worker] No service failures — skipping AI, using local analysis (score=${analysis.healthScore})`
      );
    }

    // 7. Update snapshot with results
    await db
      .update(machineSnapshots)
      .set({
        healthScore: analysis.healthScore,
        aiAnalysis: analysis,
      })
      .where(eq(machineSnapshots.id, snapshotId));

    // 8. Create alerts for issues (with dedup)
    // Only alert on warning and critical — info is noise
    const alertableIssues = analysis.issues.filter((i) => i.severity !== "info");

    for (const issue of alertableIssues) {
      const alertType = mapIssueToAlertType(issue);

      // Dedup by type + agent (not exact message, since messages contain changing values)
      const [existingAlert] = await db
        .select()
        .from(alerts)
        .where(
          and(
            eq(alerts.agentId, agent.id),
            eq(alerts.type, alertType),
            eq(alerts.severity, issue.severity),
            eq(alerts.resolved, false)
          )
        )
        .limit(1);

      if (existingAlert) {
        // Update timestamp and latest message instead of creating a duplicate
        await db
          .update(alerts)
          .set({
            message: issue.description,
            snapshotId,
            details: {
              suggestedCommand: issue.suggestedCommand,
              matchedKbId: issue.matchesKnownPattern,
              analyzedByAI: analysis.usedAI,
              updatedAt: new Date().toISOString(),
            },
          })
          .where(eq(alerts.id, existingAlert.id));
        continue;
      }

      // Check for auto-remediation
      const matchedKb = issue.matchesKnownPattern
        ? kbEntries.find((k) => k.id === issue.matchesKnownPattern)
        : null;

      const shouldAutoRemediate =
        matchedKb?.autoApply && agent.autoRemediate && issue.suggestedCommand;

      const [alert] = await db
        .insert(alerts)
        .values({
          agentId: agent.id,
          snapshotId,
          type: alertType,
          severity: issue.severity,
          message: issue.description,
          details: {
            suggestedCommand: issue.suggestedCommand,
            matchedKbId: issue.matchesKnownPattern,
            autoRemediate: shouldAutoRemediate,
            analyzedByAI: analysis.usedAI,
          },
        })
        .returning();

      if (shouldAutoRemediate && issue.suggestedCommand) {
        console.log(
          `[worker] Auto-remediating: ${issue.suggestedCommand} on ${agent.hostname}`
        );

        await db.insert(remediationLog).values({
          agentId: agent.id,
          alertId: alert.id,
          kbEntryId: matchedKb!.id,
          command: issue.suggestedCommand,
        });
      }
    }

    console.log(
      `[worker] Analysis complete for ${agent.hostname}: score=${analysis.healthScore}, issues=${analysis.issues.length}, ai=${analysis.usedAI}`
    );
  },
  {
    connection,
    concurrency: 3,
  }
);

worker.on("failed", (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err);
});

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

function mapIssueToAlertType(
  issue: Issue
): "service_down" | "high_cpu" | "high_memory" | "high_disk" | "security_issue" | "update_available" | "auth_failure" | "custom" {
  // Use the description to pick the right alert type within a category
  switch (issue.category) {
    case "security":
      if (issue.description.toLowerCase().includes("auth")) return "auth_failure";
      return "security_issue";
    case "performance":
      if (issue.description.toLowerCase().includes("memory")) return "high_memory";
      if (issue.description.toLowerCase().includes("disk")) return "high_disk";
      return "high_cpu";
    case "availability":
      return "service_down";
    case "update":
      return "update_available";
    default:
      return "custom";
  }
}

console.log("[worker] Snapshot analysis worker ready");
