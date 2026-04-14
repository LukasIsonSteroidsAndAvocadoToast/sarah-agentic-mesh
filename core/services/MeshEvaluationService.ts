import type { EvaluationJudgePort } from "@/core/ports/EvaluationJudgePort";
import { recordContentEvaluation } from "@/lib/mesh/eventStore";
import type { UniversalContent } from "@/lib/mesh/universalContentSchema";

export class MeshEvaluationService {
  constructor(private readonly judge: EvaluationJudgePort) {}

  async evaluateAndRecord(contentItemId: string, content: UniversalContent) {
    const evaluation = await this.judge.evaluate(content);
    await recordContentEvaluation(contentItemId, evaluation);
    return evaluation;
  }
}
