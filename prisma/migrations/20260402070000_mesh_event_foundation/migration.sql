-- Mesh event foundation: universal content store, immutable outbox, evaluation records, service identities.
-- This keeps Postgres as the operational event vault today and a CDC/Kafka handoff point later.

-- CreateEnum
CREATE TYPE "MeshEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "mesh_content_item" (
    "id" TEXT NOT NULL,
    "source_platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "source_channel_id" TEXT,
    "canonical_url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content_text" TEXT NOT NULL,
    "transcript_text" TEXT,
    "language_code" TEXT,
    "schema_version" TEXT NOT NULL DEFAULT 'universal-content.v1',
    "view_count" INTEGER,
    "like_count" INTEGER,
    "comment_count" INTEGER,
    "published_at" TIMESTAMPTZ(3),
    "discovered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_payload" JSONB NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mesh_content_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesh_event_outbox" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "producer" TEXT NOT NULL,
    "status" "MeshEventStatus" NOT NULL DEFAULT 'PENDING',
    "payload_json" JSONB NOT NULL,
    "headers_json" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mesh_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesh_content_evaluation" (
    "id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "evaluator_kind" TEXT NOT NULL,
    "model_name" TEXT,
    "verdict" TEXT NOT NULL,
    "quality_score" DOUBLE PRECISION,
    "contrarian_score" DOUBLE PRECISION,
    "nuance_score" DOUBLE PRECISION,
    "notes" TEXT,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mesh_content_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesh_service_identity" (
    "id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "service_kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "metadata_json" JSONB,
    "last_heartbeat_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mesh_service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mesh_content_item_source_platform_external_id_key" ON "mesh_content_item"("source_platform", "external_id");

-- CreateIndex
CREATE INDEX "mesh_content_item_source_platform_published_at_idx" ON "mesh_content_item"("source_platform", "published_at");

-- CreateIndex
CREATE INDEX "mesh_content_item_source_channel_id_idx" ON "mesh_content_item"("source_channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "mesh_event_outbox_event_key_key" ON "mesh_event_outbox"("event_key");

-- CreateIndex
CREATE INDEX "mesh_event_outbox_status_available_at_idx" ON "mesh_event_outbox"("status", "available_at");

-- CreateIndex
CREATE INDEX "mesh_event_outbox_aggregate_type_aggregate_id_idx" ON "mesh_event_outbox"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "mesh_event_outbox_event_type_created_at_idx" ON "mesh_event_outbox"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "mesh_content_evaluation_content_item_id_created_at_idx" ON "mesh_content_evaluation"("content_item_id", "created_at");

-- CreateIndex
CREATE INDEX "mesh_content_evaluation_verdict_idx" ON "mesh_content_evaluation"("verdict");

-- CreateIndex
CREATE UNIQUE INDEX "mesh_service_identity_service_name_key" ON "mesh_service_identity"("service_name");

-- AddForeignKey
ALTER TABLE "mesh_content_evaluation" ADD CONSTRAINT "mesh_content_evaluation_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "mesh_content_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
