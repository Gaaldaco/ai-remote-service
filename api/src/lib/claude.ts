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

  const prompt = `You are a system health analyzer for an RMM (Remote Monitoring & Management) tool called "AI Remote RMM".

## IMPORTANT CONTEXT — DO NOT flag these as threats:
- The "ai-remote-agent" service running on this machine IS the legitimate monitoring agent for this RMM system. It is supposed to run as root.
- Private/local IP addresses (10.x.x.x, 192.168.x.x, 172.16-31.x.x, 127.0.0.1) are legitimate admin/LAN traffic — NOT attackers.
- Ports used by the RMM dashboard (typically 3000, 5000, or similar web ports) are part of this management system.
- Failed SSH login attempts from private IPs followed by success = normal admin login with a typo, NOT a brute-force attack.

## Machine: "${agentName}" (${agentHostname}, ${agentOS})

## Rule-based analysis already found these issues:
${localAnalysis.issues.map((i) => `- [${i.severity}] ${i.category}: ${i.description}`).join("\n")}

Local health score: ${localAnalysis.healthScore}/100

## Snapshot Data
${JSON.stringify(snapshot, null, 2)}

## Monitored Services
${monitoredServices.map((s) => `- ${s.serviceName}`).join("\n") || "None"}

## Known Solutions Database
${knowledgeEntries.map((k) => `[${k.id}] Pattern: "${k.issuePattern}" → Solution: "${k.solution}" (${k.successCount} successes, ${k.failureCount} failures)`).join("\n") || "Empty"}

## Your job:
1. Analyze ONLY the issues already detected above. Provide root-cause analysis and better remediation.
2. You may COMBINE related issues (e.g. high CPU caused by a runaway process also crashing services) but do NOT invent new issues.
3. Do NOT create alerts for things that are healthy or working normally.
4. Do NOT flag the monitoring agent, private IPs, or the RMM's own ports as security threats.
5. Keep descriptions SHORT and factual (under 150 chars). No narrative or speculation.
6. Use the SAME categories as the rule-based system: "security", "performance", "availability", "update".

Respond with ONLY valid JSON (no markdown):
{
  "healthScore": <0-100>,
  "summary": "<one paragraph, factual root-cause analysis>",
  "issues": [
    {
      "category": "security|performance|availability|update",
      "severity": "info|warning|critical",
      "description": "<short factual description>",
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
