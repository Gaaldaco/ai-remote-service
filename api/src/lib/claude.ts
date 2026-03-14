import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[claude] ANTHROPIC_API_KEY not set — AI analysis disabled");
}

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-20250514";

function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (match) return match[1].trim();
  return text.trim();
}

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

interface LocalAnalysis {
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

/**
 * Only called when the rule-based analysis found critical issues or
 * monitored service failures. Starts with Haiku, escalates to Sonnet
 * if the situation is complex.
 */
export async function analyzeWithAI(
  agentName: string,
  agentHostname: string,
  agentOS: string,
  snapshot: Record<string, unknown>,
  monitoredServices: Array<{ serviceName: string }>,
  knowledgeEntries: Array<{
    id: string;
    issuePattern: string;
    solution: string;
    successCount: number;
    failureCount: number;
  }>,
  localAnalysis: LocalAnalysis
): Promise<AIAnalysisResult | null> {
  if (!client) {
    return null;
  }

  const prompt = `You are analyzing CRITICAL issues on "${agentName}" (${agentHostname}, ${agentOS}).

The local rule-based analysis already detected these problems:
${localAnalysis.issues.map((i) => `- [${i.severity}] ${i.category}: ${i.description}`).join("\n")}

Local health score: ${localAnalysis.healthScore}/100

## Snapshot Data (focus on the critical areas)
${JSON.stringify(snapshot, null, 2)}

## Monitored Services
${monitoredServices.map((s) => `- ${s.serviceName}`).join("\n") || "None"}

## Known Solutions Database
${knowledgeEntries.map((k) => `[${k.id}] Pattern: "${k.issuePattern}" → Solution: "${k.solution}" (${k.successCount} successes, ${k.failureCount} failures)`).join("\n") || "Empty"}

Provide a deeper analysis of the critical issues. Look for:
1. Root cause — why are these services down or resources maxed out?
2. Related issues the rules may have missed (e.g. a process causing both high CPU and a service crash)
3. Better remediation commands, especially if KB entries exist

Respond with ONLY valid JSON (no markdown):
{
  "healthScore": <0-100>,
  "summary": "<one paragraph focusing on the critical issues and root cause>",
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

  // Start with Haiku
  let model = HAIKU_MODEL;
  console.log(`[claude] Analyzing critical issues with ${model}`);

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const result = JSON.parse(extractJSON(text)) as AIAnalysisResult;

  // Escalate to Sonnet only if Haiku found the situation complex
  // (multiple critical issues interacting, or very low health score)
  const multipleCriticals =
    result.issues.filter((i) => i.severity === "critical").length >= 3;
  const veryLowScore = result.healthScore < 25;

  if (multipleCriticals || veryLowScore) {
    model = SONNET_MODEL;
    console.log(
      `[claude] Escalating to ${model} (score=${result.healthScore}, ${result.issues.filter((i) => i.severity === "critical").length} criticals)`
    );

    const escalatedResponse = await client.messages.create({
      model,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `ESCALATED ANALYSIS: Multiple critical issues detected. Haiku's initial findings:\n${JSON.stringify(result, null, 2)}\n\nProvide a more thorough root-cause analysis.\n\n${prompt}`,
        },
      ],
    });

    const escalatedText =
      escalatedResponse.content[0].type === "text"
        ? escalatedResponse.content[0].text
        : "";
    const escalatedResult = JSON.parse(
      extractJSON(escalatedText)
    ) as AIAnalysisResult;

    console.log(`[claude] Escalated analysis complete (${model})`);
    return escalatedResult;
  }

  console.log(`[claude] Analysis complete (${model})`);
  return result;
}
