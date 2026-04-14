/**
 * OllamaGemmaJudgeAdapter — real AI evaluation via local Gemma 4.
 *
 * Replaces the bootstrap rule engine. Calls Ollama /api/generate and
 * asks Gemma to return a structured JSON verdict on content quality,
 * contrarian angle, and nuance score.
 *
 * Fallback: if Ollama is unreachable or returns malformed JSON, the adapter
 * degrades gracefully to a deterministic score rather than crashing.
 */
import type { EvaluationJudgePort } from "@/core/ports/EvaluationJudgePort";
import type { ContentEvaluation, UniversalContent } from "@/lib/mesh/universalContentSchema";
import { getMeshEnv } from "@/lib/mesh/env";

interface GemmaVerdict {
  verdict: "ACCEPT" | "REVIEW" | "REJECT";
  quality_score: number;
  contrarian_score: number;
  nuance_score: number;
  notes: string;
}

const JUDGE_SYSTEM_PROMPT = `You are a content intelligence evaluator. Your task is to analyze a piece of content and return a JSON object with exactly these fields:
{
  "verdict": "ACCEPT" | "REVIEW" | "REJECT",
  "quality_score": 0.0-1.0,
  "contrarian_score": 0.0-1.0,
  "nuance_score": 0.0-1.0,
  "notes": "one sentence explaining the verdict"
}

Scoring guide:
- quality_score: How well-written, clear, and valuable is this for an audience?
- contrarian_score: How much does this challenge conventional thinking or offer a unique angle?
- nuance_score: How much complexity, subtlety, or layered insight does this contain?
- verdict: ACCEPT if quality_score > 0.55, REJECT if < 0.25, otherwise REVIEW.

Return ONLY the JSON object. No markdown, no explanation, no preamble.`;

function buildJudgePrompt(content: UniversalContent): string {
  const text = [content.title, content.description, content.contentText, content.transcriptText]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6_000);

  return `Platform: ${content.sourcePlatform}
Views: ${content.viewCount ?? 0}
Title: ${content.title}

Content:
${text}`;
}

function fallbackScore(content: UniversalContent): GemmaVerdict {
  const text = `${content.title} ${content.description ?? ""} ${content.contentText}`;
  const richness = Math.min(text.length / 4_000, 1);
  const engagement = Math.min((content.viewCount ?? 0) / 10_000, 1);
  const q = Number((0.45 + richness * 0.35 + engagement * 0.2).toFixed(3));
  return {
    verdict: q > 0.55 ? "ACCEPT" : q < 0.25 ? "REJECT" : "REVIEW",
    quality_score: q,
    contrarian_score: Number((Math.min(text.split("?").length / 10, 1) * 0.4).toFixed(3)),
    nuance_score: Number((Math.min(text.split(".").length / 25, 1) * 0.6).toFixed(3)),
    notes: "Fallback rule-engine (Ollama unreachable).",
  };
}

export class OllamaGemmaJudgeAdapter implements EvaluationJudgePort {
  async evaluate(content: UniversalContent): Promise<ContentEvaluation> {
    const env = getMeshEnv();

    let verdict: GemmaVerdict;

    try {
      const res = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemma3:27b",
          system: JUDGE_SYSTEM_PROMPT,
          prompt: buildJudgePrompt(content),
          stream: false,
          format: "json",
          options: { temperature: 0.3, top_p: 0.9 },
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) throw new Error(`Ollama ${res.status}`);

      const raw = (await res.json()) as { response: string };
      verdict = JSON.parse(raw.response.trim()) as GemmaVerdict;

      if (!["ACCEPT", "REVIEW", "REJECT"].includes(verdict.verdict)) {
        throw new Error("Invalid verdict field");
      }
    } catch (err) {
      console.warn("[gemma-judge] Falling back to rule engine:", (err as Error).message);
      verdict = fallbackScore(content);
    }

    return {
      evaluatorKind: "AI_JUDGE",
      modelName: "gemma3:27b",
      verdict: verdict.verdict,
      qualityScore: Math.max(0, Math.min(1, verdict.quality_score)),
      contrarianScore: Math.max(0, Math.min(1, verdict.contrarian_score)),
      nuanceScore: Math.max(0, Math.min(1, verdict.nuance_score)),
      notes: verdict.notes,
      payload: { source_platform: content.sourcePlatform, view_count: content.viewCount ?? 0 },
    };
  }
}
