import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { db } from "../db/index.js";
import { agents } from "../db/schema.js";
import { eq } from "drizzle-orm";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function agentAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const apiKey = authHeader.slice(7);
  const keyHash = hashApiKey(apiKey);

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.apiKeyHash, keyHash))
    .limit(1);

  if (!agent) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  // Attach agent to request for downstream use
  (req as any).agent = agent;
  next();
}
