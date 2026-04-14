import type { UniversalContent } from "@/lib/mesh/universalContentSchema";

export type DistributionPlatform =
  | "LINKEDIN"
  | "X_THREAD"
  | "NEWSLETTER"
  | "EMAIL_SEQUENCE";

export interface DistributionDraft {
  platform: DistributionPlatform;
  draftText: string;
  /** 0-1: how closely the draft matches the discovered Sarah DNA */
  dnaConfidence: number;
  auditNotes?: string;
}

export interface DistributionAdapterPort {
  readonly platform: DistributionPlatform;
  generate(
    content: UniversalContent,
    sarahFilter: string,
  ): Promise<DistributionDraft>;
}
