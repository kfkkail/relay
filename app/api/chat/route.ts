import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (id && !uuid.test(id)) throw new ApiError("Invalid conversation ID.");
    const { data: conversations, error } = await supabase
      .from("conversations")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    let turns: unknown[] = [];
    if (id) {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id,chat_message,created_at,runs:runs!runs_task_id_fkey(id,status,result_markdown,error,attempt)",
        )
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .limit(100)
        .order("attempt", { referencedTable: "runs", ascending: false });
      if (error) throw error;
      turns = (data ?? []).reverse();
    }
    return NextResponse.json(
      { conversations, turns },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUser();
    const body = await request.json();
    if (
      !uuid.test(body.conversationId ?? "") ||
      !uuid.test(body.messageId ?? "")
    )
      throw new ApiError("Invalid conversation or message ID.");
    if (
      typeof body.message !== "string" ||
      !body.message.trim() ||
      body.message.trim().length > 4000
    )
      throw new ApiError("Message must contain 1 to 4000 characters.");
    const { data, error } = await supabase.rpc("send_chat_message", {
      p_conversation_id: body.conversationId,
      p_message_id: body.messageId,
      p_message: body.message.trim(),
    });
    if (error) {
      if (error.message.includes("Wait for the current reply"))
        throw new ApiError(error.message, 409);
      throw error;
    }
    return NextResponse.json({ messageId: data }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
