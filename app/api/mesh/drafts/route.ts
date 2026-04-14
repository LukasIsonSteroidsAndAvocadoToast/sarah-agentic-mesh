/**
 * REST API for MeshContentDrafts — used by the factory UI and external tools.
 *
 * GET  /api/mesh/drafts?status=PENDING&platform=LINKEDIN&limit=20
 * POST /api/mesh/drafts/:id/approve   (body: { id })
 * POST /api/mesh/drafts/:id/reject    (body: { id })
 */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const platform = searchParams.get("platform");
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

  const statusAllowed = ["PENDING", "APPROVED", "REJECTED", "PUBLISHED"] as const;
  type DraftStatus = (typeof statusAllowed)[number];

  try {
    const where: Record<string, unknown> = {};
    if (status && statusAllowed.includes(status as DraftStatus)) {
      where.status = status;
    }
    if (platform) where.platform = platform;

    const drafts = await prisma.meshContentDraft.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        contentItem: {
          select: { title: true, viewCount: true, sourcePlatform: true, canonicalUrl: true },
        },
      },
    });

    return NextResponse.json({ drafts, total: drafts.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "DB error" },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { id, action } = (await request.json()) as { id: string; action: "approve" | "reject" };

  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "id and action (approve|reject) required" }, { status: 400 });
  }

  try {
    const updated = await prisma.meshContentDraft.update({
      where: { id },
      data: {
        status: action === "approve" ? "APPROVED" : "REJECTED",
        approvedAt: action === "approve" ? new Date() : null,
      },
    });
    return NextResponse.json({ draft: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 },
    );
  }
}
