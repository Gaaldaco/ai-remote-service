import { createClient } from "redis";

const redisUrl =
  process.env.REDIS_URL || "redis://redis.railway.internal:6379";

export const redis = createClient({ url: redisUrl });

redis.on("error", (err) => {
  console.error("[redis] Connection error:", err);
});

redis.on("connect", () => {
  console.log("[redis] Connected to Redis");
});

await redis.connect().catch((err) => {
  console.error("[redis] Failed to connect:", err);
});

export async function setRedis(
  key: string,
  value: unknown,
  ttlSeconds = 3600
): Promise<void> {
  try {
    await redis.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    console.error(`[redis] Failed to set ${key}:`, err);
  }
}

export async function getRedis(key: string): Promise<unknown | null> {
  try {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    console.error(`[redis] Failed to get ${key}:`, err);
    return null;
  }
}

export async function delRedis(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (err) {
    console.error(`[redis] Failed to delete ${key}:`, err);
  }
}
