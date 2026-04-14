import type { EvaluationJudgePort } from "@/core/ports/EvaluationJudgePort";
import type { ContentEvaluation, UniversalContent } from "@/lib/mesh/universalContentSchema";

/**
 * Seed judge implementation: deterministic and explicit.
 * This is intentionally simple so the port exists now; swap in Gemma/Ollama later without changing callers.
 */
export class MeshJudgeAdapter implements EvaluationJudgePort {
  async evaluate(content: UniversalContent): Promise<ContentEvaluation> {
    const text = `${content.title}\n${content.description ?? ""}\n${content.contentText}`.trim();
    const richness = Math.min(text.length / 4000, 1);
    const engagement = Math.min((content.viewCount ?? 0) / 10_000, 1);

    return {
      evaluatorKind: "RULE_ENGINE",
      modelName: "mesh-rule-judge.v1",
      verdict: engagement > 0.05 || richness > 0.2 ? "ACCEPT" : "REVIEW",
      qualityScore: Number((0.45 + richness * 0.35 + engagement * 0.2).toFixed(3)),
      contrarianScore: Number((Math.min(text.split("?").length / 10, 1) * 0.4).toFixed(3)),
      nuanceScore: Number((Math.min(text.split(".").length / 25, 1) * 0.6).toFixed(3)),
      notes: "Bootstrap judge until local model scoring is wired.",
      payload: {
        character_count: text.length,
        view_count: content.viewCount ?? 0,
      },
    };
  }
}
