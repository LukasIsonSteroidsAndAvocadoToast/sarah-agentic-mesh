/**
 * MCP Server Hub — JSON-RPC 2.0 over HTTP POST /api/mcp
 *
 * Implements the Model Context Protocol (MCP) spec without requiring the
 * @modelcontextprotocol/sdk package. Any MCP-compatible LLM client
 * (Gemma, Claude, GPT-4o) can discover and invoke these tools.
 *
 * Tools:
 *   Core data tools:
 *     mesh/list_content      → recent MeshContentItem rows
 *     mesh/get_content       → single item by id
 *     mesh/list_events       → recent outbox events
 *     mesh/service_health    → all MeshServiceIdentity heartbeats
 *     mesh/list_evaluations  → AI verdicts for a content item
 *
 *   Intelligence tools (new):
 *     mesh/search_gold       → pgvector semantic similarity search
 *     mesh/get_dna           → retrieve the current Creative DNA baseline
 *     mesh/trigger_ingest    → trigger a sensor sweep for new videos
 */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { searchGold } from "@/lib/mesh/vectorSearch";
import { getDna } from "@/lib/mesh/dnaStore";
import { UniversalContentIngestService } from "@/core/services/UniversalContentIngestService";
import { youtubeApiListSchema } from "@/lib/mesh/youtubeSchema";

// ── JSON-RPC 2.0 types ────────────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}
interface JsonRpcSuccess { jsonrpc: "2.0"; id: string | number; result: unknown; }
interface JsonRpcError { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown }; }

function ok(id: string | number, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}
function err(id: string | number | null, code: number, message: string): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ── MCP manifest ──────────────────────────────────────────────────────────────
const MCP_MANIFEST = {
  name: "sovereign-mesh-hub",
  version: "2.0.0",
  description: "SARAH-MESH-V1 Intelligence Hub — Memory (pgvector) + Voice (Gemma DNA) + Sensors (YouTube)",
  tools: [
    {
      name: "mesh/list_content",
      description: "List recent ingested content items, ordered by discoveredAt desc.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max rows (1-100, default 20)" },
          platform: { type: "string", description: "Filter by sourcePlatform (e.g. YOUTUBE)" },
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
          status: { type: "string", enum: ["PENDING", "PUBLISHED", "FAILED"] },
          limit: { type: "number" },
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
    {
      name: "mesh/search_gold",
      description: "Semantic similarity search across the pgvector store. Returns the most relevant content items for a given natural-language query.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Natural language query (e.g. 'psychology of decision making')" },
          limit: { type: "number", description: "Number of results (1-20, default 5)" },
        },
      },
    },
    {
      name: "mesh/get_dna",
      description: "Retrieve the current Creative DNA baseline — the Gemma 4 extracted system-prompt that captures the authentic voice and creative patterns from proven content.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mesh/trigger_ingest",
      description: "Trigger a sensor sweep for new videos from the sovereign YouTube channel. Runs ingestion synchronously and returns counts.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Override channel ID (defaults to UCipXVNRvJIBoZt7O_aPIgzg)" },
          minViewCount: { type: "number", description: "Minimum view count filter (default 500)" },
        },
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

// ── Intelligence tools ────────────────────────────────────────────────────────

async function handleSearchGold(params: Record<string, unknown>) {
  if (!params.query) throw new Error("query is required");
  const limit = Math.min(Number(params.limit ?? 5), 20);
  return searchGold(String(params.query), limit);
}

async function handleGetDna() {
  const dna = await getDna();
  if (!dna) {
    return {
      status: "not_yet_extracted",
      message: "No Creative DNA has been extracted yet. Run mesh:discover or mesh/trigger_ingest first.",
    };
  }
  return dna;
}

async function handleTriggerIngest(params: Record<string, unknown>) {
  const channelId = String(params.channelId ?? "UCipXVNRvJIBoZt7O_aPIgzg");
  const minViewCount = Number(params.minViewCount ?? 500);
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set on the server");

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("channelId", channelId);
  searchUrl.searchParams.set("maxResults", "25");
  searchUrl.searchParams.set("order", "viewCount");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("key", apiKey);

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) throw new Error(`YouTube search ${searchRes.status}`);
  const searchJson = (await searchRes.json()) as { items?: Array<{ id?: { videoId?: string } }> };
  const videoIds = (searchJson.items ?? []).map((i) => i.id?.videoId).filter(Boolean) as string[];
  if (videoIds.length === 0) return { ingestedCount: 0, message: "No videos found." };

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "snippet,statistics,contentDetails");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", apiKey);
  const videosRes = await fetch(videosUrl.toString());
  if (!videosRes.ok) throw new Error(`YouTube videos ${videosRes.status}`);

  const list = youtubeApiListSchema.parse(await videosRes.json());
  const service = new UniversalContentIngestService();
  let ingestedCount = 0;

  for (const item of list.items) {
    const viewCount = parseInt(item.statistics?.viewCount ?? "0", 10);
    if (viewCount < minViewCount) continue;
    await service.ingest({
      schemaVersion: "universal-content.v1",
      sourcePlatform: "YOUTUBE",
      externalId: item.id,
      sourceChannelId: channelId,
      canonicalUrl: `https://www.youtube.com/watch?v=${item.id}`,
      title: item.snippet.title,
      description: item.snippet.description,
      contentText: [item.snippet.title, item.snippet.description].filter(Boolean).join("\n\n"),
      viewCount,
      publishedAt: item.snippet.publishedAt,
      discoveredAt: new Date().toISOString(),
      rawPayload: item as unknown as Record<string, unknown>,
    });
    ingestedCount++;
  }

  return { ingestedCount, channelId, minViewCount, message: `Ingested ${ingestedCount} videos.` };
}

// ── Router ────────────────────────────────────────────────────────────────────
async function dispatch(req: JsonRpcRequest): Promise<JsonRpcSuccess | JsonRpcError> {
  const { id, method, params = {} } = req;
  try {
    switch (method) {
      case "mcp/manifest":         return ok(id, MCP_MANIFEST);
      case "mesh/list_content":    return ok(id, await handleListContent(params));
      case "mesh/get_content":     return ok(id, await handleGetContent(params));
      case "mesh/list_events":     return ok(id, await handleListEvents(params));
      case "mesh/service_health":  return ok(id, await handleServiceHealth());
      case "mesh/list_evaluations":return ok(id, await handleListEvaluations(params));
      case "mesh/search_gold":     return ok(id, await handleSearchGold(params));
      case "mesh/get_dna":         return ok(id, await handleGetDna());
      case "mesh/trigger_ingest":  return ok(id, await handleTriggerIngest(params));
      default: return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return err(id, -32603, msg);
  }
}

// ── Next.js route handlers ────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json(err(null, -32700, "Parse error"), { status: 400 }); }

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
