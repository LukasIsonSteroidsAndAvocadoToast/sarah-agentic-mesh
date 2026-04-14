import type { ContentEvaluation, UniversalContent } from "@/lib/mesh/universalContentSchema";

export interface EvaluationJudgePort {
  evaluate(content: UniversalContent): Promise<ContentEvaluation>;
}
