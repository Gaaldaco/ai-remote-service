import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[claude] ANTHROPIC_API_KEY not set — AI analysis disabled");
}

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-20250514";

export interface AIAnalysisResult {
  healthScore: number;
  summary: string;
  issues: Array<{
    category: string;
    severity: "info" | "warning" | "critical";
    description: string;
    suggestedCommand: string | null;
    matchesKnownPattern: string | null;
  }>;
}

function needsEscalation(result: AIAnalysisResult): boolean {
  if (result.healthScore < 40) return true;
  if (result.issues.some((i) => i.severity === "critical")) return true;
  return false;
}

export async function analyzeSnapshot(
  agentName: string,
  agentHostname: string,
  agentOS: string,
  snapshot: Record<string, unknown>,
  monitoredServices: Array<{ serviceName: string }>,
  recentHistory: Array<{ healthScore: number | null; timestamp: Date }>,
  knowledgeEntries: Array<{
    id: string;
    issuePattern: string;
    solution: string;
    successCount: number;
    failureCount: number;
  }>
): Promise<AIAnalysisResult> {
  if (!client) {
    return {
      healthScore: -1,
      summary: "AI analysis unavailable — ANTHROPIC_API_KEY not configured",
      issues: [],
    };
  }

  const prompt = `You are analyzing a machine health snapshot for "${agentName}" (${agentHostname}, ${agentOS}).

## Current Snapshot
${JSON.stringify(snapshot, null, 2)}

## Monitored Services (user is actively watching these)
${monitoredServices.map((s) => `- ${s.serviceName}`).join("\n") || "None pinned"}

## Recent Health History
${recentHistory.map((h) => `${h.timestamp.toISOString()}: score ${h.healthScore ?? "N/A"}`).join("\n") || "No history"}

## Known Solutions Database
${knowledgeEntries.map((k) => `[${k.id}] Pattern: "${k.issuePattern}" → Solution: "${k.solution}" (${k.successCount} successes, ${k.failureCount} failures)`).join("\n") || "Empty"}

Analyze this snapshot for:
1. Security issues (suspicious processes, failed auth attempts, open ports)
2. Performance issues (CPU, memory, disk thresholds)
3. Service availability (especially monitored services)
4. Pending updates (security-critical ones)
5. Any anomalies compared to recent history

Respond with ONLY valid JSON (no markdown):
{
  "healthScore": <0-100>,
  "summary": "<one paragraph overview>",
  "issues": [
    {
      "category": "security|performance|availability|update",
      "severity": "info|warning|critical",
      "description": "<what is wrong>",
      "suggestedCommand": "<remediation command or null>",
      "matchesKnownPattern": "<kb_entry_id or null>"
    }
  ]
}`;

  // Initial analysis with Haiku
  let model = HAIKU_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const result = JSON.parse(text) as AIAnalysisResult;

  console.log(`[claude] Analysis by ${model}`);

  // Escalate to Sonnet if critical issues or low health score
  if (needsEscalation(result)) {
    model = SONNET_MODEL;
    console.log(`[claude] Escalating to ${model} (healthScore=${result.healthScore}, critical issues found)`);

    const escalatedResponse = await client.messages.create({
      model,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `ESCALATED: A preliminary analysis found critical issues. Provide a deeper, more thorough analysis.\n\n${prompt}`,
        },
      ],
    });

    const escalatedText =
      escalatedResponse.content[0].type === "text"
        ? escalatedResponse.content[0].text
        : "";
    const escalatedResult = JSON.parse(escalatedText) as AIAnalysisResult;

    console.log(`[claude] Analysis by ${model}`);
    return escalatedResult;
  }

  return result;
}
