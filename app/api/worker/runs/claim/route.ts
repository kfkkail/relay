import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { requireWorker } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { supabase, worker } = await requireWorker(request);
    const { data, error } = await supabase.rpc("claim_next_run", {
      p_worker_id: worker.id,
    });
    if (error) throw error;
    const claimed = data?.[0];
    if (!claimed) return new NextResponse(null, { status: 204 });

    return NextResponse.json(
      {
        run: {
          id: claimed.run_id,
          attempt: claimed.attempt,
          feedback: claimed.feedback,
        },
        task: {
          id: claimed.task_id,
          title: claimed.title,
          instructions: claimed.instructions,
          deliverable: claimed.deliverable,
        },
        attachments: claimed.attachments ?? [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
