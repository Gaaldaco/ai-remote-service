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

/**
 * Given a KB entry with solutionSteps and current snapshot data,
 * generate the correct dynamic remediation command for THIS instance.
 * E.g., KB says "find top CPU process and kill by name" → AI looks at
 * current snapshot, sees stress-ng at 95% CPU, returns "pkill -9 stress-ng"
 */
export async function generateDynamicRemediation(
  kbEntry: {
    issuePattern: string;
    solution: string;
    solutionSteps: unknown;
  },
  snapshot: Record<string, unknown>,
  hostname: string
): Promise<string | null> {
  if (!client) return null;

  const steps = kbEntry.solutionSteps as Array<{
    type: string;
    command: string;
    reason: string;
  }>;

  if (!steps || steps.length === 0) return null;

  const prompt = `You are an auto-remediation engine. A known issue has recurred and you need to generate the correct fix command for THIS specific instance.

## Known Issue Pattern
"${kbEntry.issuePattern}"

## Documented Fix Approach
${kbEntry.solution}

## Diagnostic Path (from last time this was fixed)
${steps.map((s, i) => `${i + 1}. [${s.type}] ${s.command} — ${s.reason}`).join("\n")}

## Current Machine State (${hostname})
Processes: ${JSON.stringify((snapshot.processes as any[])?.slice(0, 15) ?? [])}
CPU: ${JSON.stringify(snapshot.cpu)}
Memory: ${JSON.stringify(snapshot.memory)}
Services: ${JSON.stringify(snapshot.services)}

## Your task
Based on the documented fix path and CURRENT machine state, output the SINGLE command that should be run right now to fix this issue.
- Use process NAMES, not PIDs
- Use pkill/killall/systemctl, never kill with a hardcoded PID
- If you can't determine the right command from the current state, respond with "SKIP"

Respond with ONLY the command (no explanation, no markdown):`;

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";

    if (!text || text === "SKIP" || text.includes("SKIP")) {
      console.log(`[claude] Dynamic remediation skipped for "${kbEntry.issuePattern}" — AI couldn't determine command`);
      return null;
    }

    // Safety: reject if it contains a hardcoded PID (kill <number>)
    if (/\bkill\b.*\b\d{3,}\b/.test(text) && !/pkill|killall/.test(text)) {
      console.warn(`[claude] Rejected dynamic command with hardcoded PID: ${text}`);
      return null;
    }

    console.log(`[claude] Dynamic remediation for "${kbEntry.issuePattern}": ${text}`);
    return text;
  } catch (err) {
    console.error(`[claude] Dynamic remediation generation failed:`, err);
    return null;
  }
}

/**
 * Diagnose a failed apt-get update/upgrade and return a fix command.
 * Common issues: stale package lists, broken repos, dpkg locks, dependency conflicts.
 */
export async function diagnoseUpdateFailure(
  errorOutput: string,
  hostname: string,
  os: string
): Promise<string | null> {
  if (!client) return null;

  const prompt = `You are a Linux sysadmin. An automatic "apt-get update && apt-get upgrade" failed on ${hostname} (${os}).

## Error output:
${errorOutput}

## Your task:
Return a SINGLE shell command that fixes the root cause so the update can succeed on retry.

Common fixes:
- "apt-get update" alone if package lists are stale (404 Not Found)
- "apt-get update --fix-missing" for missing archives
- "dpkg --configure -a" for interrupted dpkg
- "apt-get install -f" for broken dependencies
- "sed -i" to fix/remove broken repo entries in /etc/apt/sources.list.d/
- "apt-get clean && apt-get update" for corrupted cache

RULES:
- Return ONLY the command. No explanation, no markdown.
- The command must be non-interactive (no prompts)
- NEVER remove packages, NEVER run "rm -rf", NEVER reboot
- If you can't determine a fix, respond with "SKIP"`;

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";

    if (!text || text === "SKIP" || text.includes("SKIP")) {
      console.log(`[claude] Could not diagnose update failure on ${hostname}`);
      return null;
    }

    // Safety: reject dangerous commands
    if (/rm\s+-rf|reboot|shutdown|mkfs|dd\s+if/.test(text)) {
      console.warn(`[claude] Rejected dangerous update fix: ${text}`);
      return null;
    }

    console.log(`[claude] Update fix for ${hostname}: ${text}`);
    return text;
  } catch (err) {
    console.error(`[claude] Update diagnosis failed:`, err);
    return null;
  }
}
