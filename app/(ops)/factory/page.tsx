/**
 * /ops/factory — Human-in-the-Loop Review Dashboard
 *
 * Lists all PENDING drafts from the ContentWaterfall.
 * Shows DNA Confidence Score for each draft.
 * One-click approve/reject pushes to DistributionQueue.
 */
import { prisma } from "@/lib/db";
import { getDna } from "@/lib/mesh/dnaStore";
import { approveDraft, rejectDraft } from "./actions";

const PLATFORM_LABELS: Record<string, { label: string; color: string; emoji: string }> = {
  LINKEDIN:       { label: "LinkedIn",   color: "bg-blue-500/20 text-blue-300 border-blue-500/30",    emoji: "💼" },
  X_THREAD:       { label: "X Thread",   color: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",    emoji: "𝕏" },
  NEWSLETTER:     { label: "Newsletter", color: "bg-amber-500/20 text-amber-300 border-amber-500/30", emoji: "📰" },
  EMAIL_SEQUENCE: { label: "Email",      color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", emoji: "✉️" },
};

function DnaBar({ score }: { score: number | null }) {
  const pct = Math.round((score ?? 0) * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 45 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-zinc-700">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-400">{pct}%</span>
    </div>
  );
}

export default async function FactoryPage() {
  type DraftWithItem = {
    id: string; contentItemId: string; workflowId: string | null; platform: string;
    draftText: string; dnaConfidence: number | null; status: string;
    auditNotes: string | null; approvedAt: Date | null; createdAt: Date; updatedAt: Date;
    contentItem: { title: string; viewCount: number | null; sourcePlatform: string };
  };
  let drafts: DraftWithItem[] = [];
  let dna: Awaited<ReturnType<typeof getDna>> = null;
  let dbError: string | null = null;

  try {
    [drafts, dna] = await Promise.all([
      prisma.meshContentDraft.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { contentItem: { select: { title: true, viewCount: true, sourcePlatform: true } } },
      }) as Promise<DraftWithItem[]>,
      getDna(),
    ]);
  } catch (e) {
    dbError = e instanceof Error ? e.message : "Database unreachable";
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Sovereign Content Factory</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Review AI-generated drafts before they enter the Distribution Queue.
          </p>
        </div>

        {/* DNA Status */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Creative DNA Baseline</span>
            {dna ? (
              <span className="text-xs text-emerald-400">● Active — extracted {new Date(dna.extractedAt).toLocaleDateString()}</span>
            ) : (
              <span className="text-xs text-amber-400">● Not yet extracted — run mesh:discover</span>
            )}
          </div>
          {dna && (
            <p className="text-sm text-zinc-300 leading-relaxed line-clamp-3">{dna.dnaPrompt}</p>
          )}
        </div>

        {/* DB Error State */}
        {dbError && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
            <strong>Database unreachable:</strong> {dbError}
            <br />
            <span className="text-zinc-500">Start the DB with <code className="text-zinc-300">limactl start architect</code> then reload.</span>
          </div>
        )}

        {/* Stats Row */}
        {!dbError && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(["LINKEDIN", "X_THREAD", "NEWSLETTER", "EMAIL_SEQUENCE"] as const).map((p) => {
              const meta = PLATFORM_LABELS[p]!;
              const count = drafts.filter((d) => d.platform === p).length;
              return (
                <div key={p} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <div className="text-lg">{meta.emoji}</div>
                  <div className="text-xl font-bold mt-1">{count}</div>
                  <div className="text-xs text-zinc-500">{meta.label} pending</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Draft Cards */}
        {!dbError && drafts.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center text-zinc-500">
            No pending drafts. Run <code className="text-zinc-300">npm run mesh:discover</code> to generate gold, then trigger a waterfall.
          </div>
        )}

        {!dbError && drafts.length > 0 && (
          <div className="space-y-4">
            {drafts.map((draft) => {
              const meta = PLATFORM_LABELS[draft.platform] ?? { label: draft.platform, color: "bg-zinc-800 text-zinc-300 border-zinc-700", emoji: "📄" };
              return (
                <div key={draft.id} className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                  {/* Card Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${meta.color}`}>
                        {meta.emoji} {meta.label}
                      </span>
                      <span className="text-sm text-zinc-300 font-medium truncate max-w-xs">
                        {draft.contentItem.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="hidden sm:block">
                        <div className="text-xs text-zinc-500 mb-0.5">DNA Match</div>
                        <DnaBar score={draft.dnaConfidence} />
                      </div>
                      <div className="flex gap-2">
                        <form action={approveDraft.bind(null, draft.id)}>
                          <button
                            type="submit"
                            className="px-3 py-1 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
                          >
                            Approve
                          </button>
                        </form>
                        <form action={rejectDraft.bind(null, draft.id)}>
                          <button
                            type="submit"
                            className="px-3 py-1 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-medium transition-colors"
                          >
                            Reject
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>

                  {/* Draft Text Preview */}
                  <div className="px-4 py-3">
                    <pre className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans line-clamp-6">
                      {draft.draftText}
                    </pre>
                  </div>

                  {/* Audit Notes */}
                  {draft.auditNotes && (
                    <div className="px-4 py-2 bg-zinc-800/50 border-t border-zinc-800">
                      <span className="text-xs text-zinc-500">Audit: </span>
                      <span className="text-xs text-zinc-400">{draft.auditNotes}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
