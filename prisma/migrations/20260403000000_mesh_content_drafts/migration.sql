-- Phase 4: Distribution Grid — content draft table for the Waterfall Factory.
-- Every AI-generated piece of content lives here before human approval.

-- CreateEnum
CREATE TYPE "MeshDraftStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "mesh_content_draft" (
    "id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "workflow_id" TEXT,
    "platform" TEXT NOT NULL,
    "draft_text" TEXT NOT NULL,
    "dna_confidence" DOUBLE PRECISION,
    "status" "MeshDraftStatus" NOT NULL DEFAULT 'PENDING',
    "audit_notes" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mesh_content_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mesh_content_draft_content_item_id_created_at_idx" ON "mesh_content_draft"("content_item_id", "created_at");

-- CreateIndex
CREATE INDEX "mesh_content_draft_platform_status_idx" ON "mesh_content_draft"("platform", "status");

-- AddForeignKey
ALTER TABLE "mesh_content_draft" ADD CONSTRAINT "mesh_content_draft_content_item_id_fkey"
    FOREIGN KEY ("content_item_id") REFERENCES "mesh_content_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
