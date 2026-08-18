import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import { optionalDate, ownerActionSelect } from "@/lib/owner-actions";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50));
    const from = (page - 1) * pageSize;
    const { data, error, count } = await supabase
      .from("owner_actions")
      .select(ownerActionSelect, { count: "exact" })
      .order("due_at", { ascending: true, nullsFirst: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    return NextResponse.json({ actions: data ?? [], page, pageSize, total: count ?? 0 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (!title) throw new ApiError("Action title is required.");
    if (title.length > 160) throw new ApiError("Action title must be 160 characters or fewer.");
    if (notes.length > 20000) throw new ApiError("Notes must be 20,000 characters or fewer.");
    const { data, error } = await supabase
      .from("owner_actions")
      .insert({ user_id: user.id, title, notes, due_at: optionalDate(body.dueAt, "Due date") })
      .select(ownerActionSelect)
      .single();
    if (error) throw error;
    return NextResponse.json({ action: data }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
