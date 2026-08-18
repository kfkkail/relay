import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUser();
    const body = await request.json();
    if (!Array.isArray(body.actionIds) || !body.actionIds.every((id: unknown) => typeof id === "string") || new Set(body.actionIds).size !== body.actionIds.length) {
      throw new ApiError("A unique ordered actionIds list is required.");
    }
    const results = await Promise.all(body.actionIds.map((id: string, position: number) => supabase.from("owner_actions").update({ position }).eq("id", id).select("id").single()));
    if (results.some((result) => result.error || !result.data)) throw new ApiError("Could not reorder every action.");
    return NextResponse.json({ actionIds: body.actionIds });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
