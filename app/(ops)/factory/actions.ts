"use server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function approveDraft(draftId: string) {
  await prisma.meshContentDraft.update({
    where: { id: draftId },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  revalidatePath("/ops/factory");
}

export async function rejectDraft(draftId: string) {
  await prisma.meshContentDraft.update({
    where: { id: draftId },
    data: { status: "REJECTED" },
  });
  revalidatePath("/ops/factory");
}
