#!/usr/bin/env tsx
/**
 * CLI entry point for the Outbox Relay daemon.
 * Run: tsx scripts/mesh-outbox-relay.ts
 * Or:  npm run mesh:relay
 */
import { runOutboxRelay } from "@/lib/mesh/outboxRelay";
import { disconnectProducer } from "@/lib/mesh/kafkaClient";

const controller = new AbortController();

process.on("SIGTERM", () => {
  console.log("[relay] SIGTERM — initiating graceful shutdown");
  controller.abort();
});
process.on("SIGINT", () => {
  console.log("[relay] SIGINT — initiating graceful shutdown");
  controller.abort();
});

runOutboxRelay(controller.signal)
  .then(() => disconnectProducer())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[relay] Fatal:", err);
    process.exit(1);
  });
