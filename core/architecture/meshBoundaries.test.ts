/**
 * Architecture Fitness Functions — Sovereign Mesh Boundaries
 *
 * Enforces:
 *  1. Schema Integrity — universal content contract + event envelope are present.
 *  2. Outbox Pattern  — eventStore uses the outbox table, not direct topic publish.
 *  3. Hexagonal Isolation — core/services must NOT import from app/, pages/, or
 *     components/ (Strangler Fig guard).
 *  4. Mesh-to-Legacy Firewall — lib/mesh/* must NOT import from legacy
 *     SqueezePages, app/(SqueezePages), or intelligence-unit.
 *  5. Raw-pg Outbox Relay — the relay must use node-postgres, NOT Prisma, for
 *     the critical write path (zero-overhead guarantee).
 *  6. Kafka Client Singleton — kafkaClient must export getMeshProducer and
 *     publishToKafka.
 *  7. MCP Server Hub — the route must implement the mcp/manifest method.
 *  8. Workflow Contract — IngestionWorkflow must define discoveryIngestionWorkflow.
 *  9. Embedding Worker — must call /api/embeddings (Ollama Metal path).
 * 10. Docker Compose Mesh Profile — Kafka and Temporal services must be present
 *     under the "mesh" profile.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function importsInFile(rel: string): string[] {
  const content = read(rel);
  const matches = [...content.matchAll(/from\s+["']([^"']+)["']/g)];
  return matches.map((m) => m[1]);
}

function allTsFilesIn(dir: string): string[] {
  const abs = path.join(root, dir);
  const out: string[] = [];
  try {
    for (const entry of readdirSync(abs, { recursive: true } as Parameters<typeof readdirSync>[1])) {
      const name = String(entry);
      if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        out.push(path.join(dir, name));
      }
    }
  } catch { /* dir may not exist yet */ }
  return out;
}

// ── 1. Schema Integrity ───────────────────────────────────────────────────────
describe("1. Schema Integrity", () => {
  it("universal-content.v1 contract is defined", () => {
    const f = read("lib/mesh/universalContentSchema.ts");
    expect(f).toContain("universal-content.v1");
    expect(f).toContain("mesh-event.v1");
    expect(f).toContain("universalContentSchema");
    expect(f).toContain("meshEventEnvelopeSchema");
  });
});

// ── 2. Outbox Pattern ────────────────────────────────────────────────────────
describe("2. Outbox Pattern", () => {
  it("eventStore writes to MeshEventOutbox inside a transaction", () => {
    const f = read("lib/mesh/eventStore.ts");
    expect(f).toContain("meshEventOutbox");
    expect(f).toContain("saveUniversalContentWithOutbox");
    expect(f).toContain("$transaction");
  });

  it("eventStore does NOT publish directly to Kafka (only the relay does)", () => {
    const f = read("lib/mesh/eventStore.ts");
    expect(f).not.toContain("kafkaClient");
    expect(f).not.toContain("publishToKafka");
  });
});

// ── 3. Hexagonal Isolation (Strangler Fig guard) ──────────────────────────────
describe("3. Hexagonal Isolation — core/services has no UI imports", () => {
  const FORBIDDEN_PREFIXES = [
    "@/app/",
    "@/components/",
    "@/pages/",
    "../app/",
    "../components/",
    "../pages/",
  ];

  const coreFiles = allTsFilesIn("core/services");

  it("core service files exist", () => {
    expect(coreFiles.length).toBeGreaterThan(0);
  });

  for (const rel of coreFiles) {
    it(`${rel} has no UI layer imports`, () => {
      const imports = importsInFile(rel);
      for (const imp of imports) {
        for (const prefix of FORBIDDEN_PREFIXES) {
          expect(imp, `${rel} imports UI path: ${imp}`).not.toMatch(new RegExp(`^${prefix.replace(/\//g, "\\/")}`));
        }
      }
    });
  }
});

// ── 4. Mesh-to-Legacy Firewall ────────────────────────────────────────────────
describe("4. Mesh-to-Legacy Firewall — lib/mesh does not touch legacy paths", () => {
  const LEGACY_PATTERNS = [
    /SqueezePages/,
    /intelligence-unit/,
    /Consent_Collector/,
    /Squeeze_Form/,
  ];

  const meshFiles = allTsFilesIn("lib/mesh");

  it("mesh files exist", () => {
    expect(meshFiles.length).toBeGreaterThan(0);
  });

  for (const rel of meshFiles) {
    it(`${rel} does not import from legacy directories`, () => {
      const content = read(rel);
      for (const pattern of LEGACY_PATTERNS) {
        expect(content, `${rel} references legacy path matching ${pattern}`).not.toMatch(pattern);
      }
    });
  }
});

// ── 5. Raw-pg Outbox Relay ────────────────────────────────────────────────────
describe("5. Raw-pg Outbox Relay", () => {
  it("outboxRelay uses node-postgres Pool, not Prisma", () => {
    const f = read("lib/mesh/outboxRelay.ts");
    expect(f).toContain("from \"pg\"");
    expect(f).not.toContain("from \"@prisma/client\"");
    expect(f).not.toContain("prisma.");
  });

  it("outboxRelay uses SKIP LOCKED for at-least-once delivery", () => {
    const f = read("lib/mesh/outboxRelay.ts");
    expect(f).toContain("SKIP LOCKED");
  });
});

// ── 6. Kafka Client Singleton ────────────────────────────────────────────────
describe("6. Kafka Client Singleton", () => {
  it("exports getMeshProducer and publishToKafka", () => {
    const f = read("lib/mesh/kafkaClient.ts");
    expect(f).toContain("getMeshProducer");
    expect(f).toContain("publishToKafka");
  });
});

// ── 7. MCP Server Hub ────────────────────────────────────────────────────────
describe("7. MCP Server Hub", () => {
  it("implements mcp/manifest and mesh/* tool methods", () => {
    const f = read("app/api/mcp/route.ts");
    expect(f).toContain("mcp/manifest");
    expect(f).toContain("mesh/list_content");
    expect(f).toContain("mesh/list_events");
    expect(f).toContain("jsonrpc");
  });
});

// ── 8. Workflow Contract ──────────────────────────────────────────────────────
describe("8. Temporal Workflow Contract", () => {
  it("defines discoveryIngestionWorkflow with correct input shape", () => {
    const f = read("core/services/mesh/IngestionWorkflow.ts");
    expect(f).toContain("discoveryIngestionWorkflow");
    expect(f).toContain("DiscoveryIngestionWorkflowInput");
    expect(f).toContain("minViewCount");
    expect(f).toContain("extractDna");
  });

  it("DNA extraction calls Ollama with high-entropy settings", () => {
    const f = read("core/services/mesh/IngestionWorkflow.ts");
    expect(f).toContain("temperature");
    expect(f).toContain("top_p");
    expect(f).toContain("/api/generate");
  });
});

// ── 9. Embedding Worker ───────────────────────────────────────────────────────
describe("9. Embedding Worker (Metal path)", () => {
  it("calls /api/embeddings and writes vector column", () => {
    const f = read("lib/mesh/embeddingWorker.ts");
    expect(f).toContain("/api/embeddings");
    expect(f).toContain("::vector");
    expect(f).toContain("embedding IS NULL");
  });
});

// ── 10. Docker Compose Mesh Profile ──────────────────────────────────────────
describe("10. Docker Compose Mesh Profile", () => {
  it("Kafka service exists under mesh profile", () => {
    const f = read("docker-compose.monster.yml");
    expect(f).toContain("mesh_kafka");
    expect(f).toContain("bitnami/kafka");
    expect(f).toContain("KAFKA_CFG_PROCESS_ROLES=broker,controller");
  });

  it("Temporal server + UI exist under mesh profile", () => {
    const f = read("docker-compose.monster.yml");
    expect(f).toContain("mesh_temporal");
    expect(f).toContain("temporalio/auto-setup");
    expect(f).toContain("mesh_temporal_ui");
  });

  it("mesh_grid network is declared", () => {
    const f = read("docker-compose.monster.yml");
    expect(f).toContain("mesh_grid:");
  });
});
