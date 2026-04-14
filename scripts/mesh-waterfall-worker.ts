#!/usr/bin/env tsx
/**
 * Waterfall Temporal Worker — polls 'sarah-waterfall' task queue.
 * Handles ContentWaterfallWorkflow (4-format parallel generation).
 *
 * Run: npm run mesh:waterfall
 * Requires: Temporal server running (npm run mesh:up)
 */
import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "@/core/services/mesh/ContentWaterfallActivities";
import { getMeshEnv } from "@/lib/mesh/env";
import path from "node:path";

const TASK_QUEUE = "sarah-waterfall";

async function main() {
  const env = getMeshEnv();
  console.log(`[waterfall-worker] Connecting to ${env.TEMPORAL_ADDRESS}`);

  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: path.resolve(__dirname, "../core/services/mesh/ContentWaterfallWorkflow"),
    activities,
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 2,
  });

  console.log(`[waterfall-worker] Ready on task queue: ${TASK_QUEUE}`);

  process.on("SIGTERM", () => { console.log("[waterfall-worker] Shutting down…"); worker.shutdown(); });
  process.on("SIGINT",  () => { console.log("[waterfall-worker] Shutting down…"); worker.shutdown(); });

  await worker.run();
}

main().catch((err) => { console.error("[waterfall-worker] Fatal:", err); process.exit(1); });
