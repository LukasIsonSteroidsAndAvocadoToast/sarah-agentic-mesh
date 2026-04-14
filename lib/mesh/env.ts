/**
 * Validated environment for the Sovereign Mesh.
 * Import this instead of process.env to get type-safe, runtime-checked config.
 */
import { z } from "zod";

const meshEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  KAFKA_BROKERS: z.string().default("mesh_kafka:9092"),
  KAFKA_CLIENT_ID: z.string().default("sovereign-mesh"),
  KAFKA_TOPIC_CONTENT_EVENTS: z.string().default("mesh.content.events"),
  TEMPORAL_ADDRESS: z.string().default("mesh_temporal:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  OLLAMA_HOST: z.string().url().default("http://localhost:11434"),
  OLLAMA_EMBED_MODEL: z.string().default("all-minilm"),
  YOUTUBE_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type MeshEnv = z.infer<typeof meshEnvSchema>;

let _meshEnv: MeshEnv | null = null;

export function getMeshEnv(): MeshEnv {
  if (!_meshEnv) {
    const parsed = meshEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error("[mesh/env] Invalid mesh environment:", parsed.error.flatten());
      throw new Error("Mesh environment validation failed — check .env");
    }
    _meshEnv = parsed.data;
  }
  return _meshEnv;
}
