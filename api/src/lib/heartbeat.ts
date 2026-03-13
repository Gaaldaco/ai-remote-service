import { db } from "../db/index.js";
import { agents, alerts } from "../db/schema.js";
import { eq, and, lt, ne } from "drizzle-orm";

const OFFLINE_THRESHOLD_MS = 90_000; // 90 seconds
const CHECK_INTERVAL_MS = 60_000; // check every 60 seconds

export function startHeartbeatMonitor() {
  console.log("[heartbeat] Starting heartbeat monitor");

  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD_MS);

      // Find agents that are currently online but haven't been seen recently
      const staleAgents = await db
        .select({ id: agents.id, name: agents.name, hostname: agents.hostname })
        .from(agents)
        .where(
          and(
            ne(agents.status, "offline"),
            lt(agents.lastSeen, cutoff)
          )
        );

      for (const agent of staleAgents) {
        console.log(`[heartbeat] Agent ${agent.name} (${agent.hostname}) went offline`);

        // Mark offline
        await db
          .update(agents)
          .set({ status: "offline", updatedAt: new Date() })
          .where(eq(agents.id, agent.id));

        // Create alert
        await db.insert(alerts).values({
          agentId: agent.id,
          type: "agent_offline",
          severity: "critical",
          message: `Agent "${agent.name}" (${agent.hostname}) has gone offline`,
        });
      }
    } catch (err) {
      console.error("[heartbeat] Error:", err);
    }
  }, CHECK_INTERVAL_MS);
}
