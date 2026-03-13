import { Queue } from "bullmq";

const redisUrl =
  process.env.REDIS_URL || "redis://redis.railway.internal:6379";

const connection = { url: redisUrl };

export const snapshotQueue = new Queue("snapshot-analysis", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const remediationQueue = new Queue("remediation", {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
