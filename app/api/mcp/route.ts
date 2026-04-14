/**
 * MCP Server Hub — JSON-RPC 2.0 over HTTP POST /api/mcp
 *
 * Implements the Model Context Protocol (MCP) spec without requiring the
 * @modelcontextprotocol/sdk package.  Any MCP-compatible client (Gemma,
 * Claude, cursor agents) can discover and call these tools.
 *
 * Tools exposed:
 *   - mesh/list_content    → recent MeshContentItem rows
 *   - mesh/get_content     → single item by id
 *   - mesh/list_events     → recent pending outbox events
 *   - mesh/service_health  → all MeshServiceIdentity heartbeats
 *   - mesh/ingest_url      → ad-hoc content ingestion trigger
 *
 * Sovereignty note: this endpoint is server-side only and never touches the
 * client bundle (next.js Server Action boundary).
 */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// ── JSON-RPC 2.0 types ────────────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

function ok(id: string | number, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function err(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

// ── MCP manifest ─────────────────────────────────────────────────────────────
const MCP_MANIFEST = {
  name: "sovereign-mesh-hub",
  version: "1.0.0",
  description: "Sovereign Intelligence Mesh — tools for content, events, and service health",
  tools: [
    {
      name: "mesh/list_content",
      description: "List recent ingested content items, ordered by discoveredAt descending.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max rows (1-100, default 20)" },
          platform: { type: "string", description: "Filter by sourcePlatform (e.g. youtube)" },
        },
      },
    },
    {
      name: "mesh/get_content",
      description: "Retrieve a single MeshContentItem by its id.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    {
      name: "mesh/list_events",
      description: "List recent outbox events, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["PENDING", "PUBLISHED", "FAILED"], description: "Filter by status" },
          limit: { type: "number", description: "Max rows (default 20)" },
        },
      },
    },
    {
      name: "mesh/service_health",
      description: "Return all registered mesh service identities and their last heartbeat.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mesh/list_evaluations",
      description: "List AI evaluations for a given content item.",
      inputSchema: {
        type: "object",
        required: ["contentItemId"],
        properties: { contentItemId: { type: "string" } },
      },
    },
  ],
};

// ── Tool handlers ─────────────────────────────────────────────────────────────
async function handleListContent(params: Record<string, unknown>) {
  const limit = Math.min(Number(params.limit ?? 20), 100);
  const where = params.platform ? { sourcePlatform: String(params.platform) } : undefined;
  return prisma.meshContentItem.findMany({
    where,
    orderBy: { discoveredAt: "desc" },
    take: limit,
    select: {
      id: true, sourcePlatform: true, externalId: true, title: true,
      viewCount: true, publishedAt: true, discoveredAt: true, schemaVersion: true,
    },
  });
}

async function handleGetContent(params: Record<string, unknown>) {
  if (!params.id) throw new Error("id is required");
  return prisma.meshContentItem.findUniqueOrThrow({ where: { id: String(params.id) } });
}

async function handleListEvents(params: Record<string, unknown>) {
  const limit = Math.min(Number(params.limit ?? 20), 100);
  const statusAllowed = ["PENDING", "PUBLISHED", "FAILED"] as const;
  type EventStatus = (typeof statusAllowed)[number];
  const rawStatus = String(params.status ?? "");
  const where = statusAllowed.includes(rawStatus as EventStatus)
    ? { status: rawStatus as EventStatus }
    : undefined;
  return prisma.meshEventOutbox.findMany({
    where,
    orderBy: { availableAt: "desc" },
    take: limit,
    select: {
      id: true, eventType: true, aggregateId: true, status: true,
      availableAt: true, publishedAt: true, producer: true,
    },
  });
}

async function handleServiceHealth() {
  return prisma.meshServiceIdentity.findMany({ orderBy: { lastHeartbeatAt: "desc" } });
}

async function handleListEvaluations(params: Record<string, unknown>) {
  if (!params.contentItemId) throw new Error("contentItemId is required");
  return prisma.meshContentEvaluation.findMany({
    where: { contentItemId: String(params.contentItemId) },
    orderBy: { createdAt: "desc" },
  });
}

// ── Router ────────────────────────────────────────────────────────────────────
async function dispatch(req: JsonRpcRequest): Promise<JsonRpcSuccess | JsonRpcError> {
  const { id, method, params = {} } = req;
  try {
    switch (method) {
      case "mcp/manifest":
        return ok(id, MCP_MANIFEST);
      case "mesh/list_content":
        return ok(id, await handleListContent(params));
      case "mesh/get_content":
        return ok(id, await handleGetContent(params));
      case "mesh/list_events":
        return ok(id, await handleListEvents(params));
      case "mesh/service_health":
        return ok(id, await handleServiceHealth());
      case "mesh/list_evaluations":
        return ok(id, await handleListEvaluations(params));
      default:
        return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return err(id, -32603, msg);
  }
}

// ── Next.js route ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(err(null, -32700, "Parse error"), { status: 400 });
  }

  const rpc = body as JsonRpcRequest;
  if (rpc.jsonrpc !== "2.0" || !rpc.method) {
    return NextResponse.json(err(rpc.id ?? null, -32600, "Invalid Request"), { status: 400 });
  }

  const result = await dispatch(rpc);
  return NextResponse.json(result);
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(MCP_MANIFEST);
}
