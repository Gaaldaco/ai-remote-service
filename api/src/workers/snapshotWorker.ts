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
import { eq, desc } from "drizzle-orm";
import { analyzeSnapshot } from "../lib/claude.js";

const redisUrl =
  process.env.REDIS_URL || "redis://redis.railway.internal:6379";

const connection = { url: redisUrl };

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

    // 3. Fetch recent snapshot history (last 5)
    const recentHistory = await db
      .select({
        healthScore: machineSnapshots.healthScore,
        timestamp: machineSnapshots.timestamp,
      })
      .from(machineSnapshots)
      .where(eq(machineSnapshots.agentId, agentId))
      .orderBy(desc(machineSnapshots.timestamp))
      .limit(5);

    // 4. Fetch monitored services
    const monitored = await db
      .select({ serviceName: monitoredServices.serviceName })
      .from(monitoredServices)
      .where(eq(monitoredServices.agentId, agentId));

    // 5. Fetch knowledge base entries for this platform
    const kbEntries = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.platform, agent.platform));

    // 6. Run AI analysis
    const analysis = await analyzeSnapshot(
      agent.name,
      agent.hostname,
      agent.os,
      {
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
      },
      monitored,
      recentHistory,
      kbEntries.map((k) => ({
        id: k.id,
        issuePattern: k.issuePattern,
        solution: k.solution,
        successCount: k.successCount,
        failureCount: k.failureCount,
      }))
    );

    // 7. Update snapshot with AI results
    await db
      .update(machineSnapshots)
      .set({
        healthScore: analysis.healthScore,
        aiAnalysis: analysis,
      })
      .where(eq(machineSnapshots.id, snapshotId));

    // 8. Process issues
    for (const issue of analysis.issues) {
      // Check if there's a matching KB entry for auto-remediation
      const matchedKb = issue.matchesKnownPattern
        ? kbEntries.find((k) => k.id === issue.matchesKnownPattern)
        : null;

      const shouldAutoRemediate =
        matchedKb?.autoApply && agent.autoRemediate && issue.suggestedCommand;

      // Create alert
      const [alert] = await db
        .insert(alerts)
        .values({
          agentId: agent.id,
          snapshotId,
          type: mapCategoryToAlertType(issue.category),
          severity: issue.severity,
          message: issue.description,
          details: {
            suggestedCommand: issue.suggestedCommand,
            matchedKbId: issue.matchesKnownPattern,
            autoRemediate: shouldAutoRemediate,
          },
        })
        .returning();

      // Auto-remediate if conditions are met
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

    // 9. Check monitored services
    const services = (snapshot.services as any[]) ?? [];
    for (const mon of monitored) {
      const svc = services.find(
        (s: any) => s.name === mon.serviceName
      );

      if (!svc || svc.status === "failed" || svc.status === "stopped") {
        // Check if there's already an unresolved alert for this
        await db.insert(alerts).values({
          agentId: agent.id,
          snapshotId,
          type: "service_down",
          severity: "critical",
          message: `Monitored service "${mon.serviceName}" is ${svc?.status ?? "not found"} on ${agent.hostname}`,
        });
      }
    }

    console.log(
      `[worker] Analysis complete for ${agent.hostname}: score=${analysis.healthScore}, issues=${analysis.issues.length}`
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

function mapCategoryToAlertType(
  category: string
): "service_down" | "high_cpu" | "high_memory" | "high_disk" | "security_issue" | "update_available" | "auth_failure" | "custom" {
  switch (category) {
    case "security":
      return "security_issue";
    case "performance":
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
