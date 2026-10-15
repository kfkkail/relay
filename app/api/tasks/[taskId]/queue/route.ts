import { NextResponse } from "next/server";
import { apiErrorResponse, requireUser } from "@/lib/http";
import { queueTask } from "@/lib/queue-task";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const { supabase, user } = await requireUser();
    const runId = await queueTask(supabase, user, taskId);
    return NextResponse.json({ runId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
