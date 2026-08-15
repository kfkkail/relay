import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import { hashWorkerToken } from "@/lib/worker-auth";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiError("Worker name is required.");
    const token = `relay_${randomBytes(32).toString("base64url")}`;
    const { data, error } = await supabase
      .from("workers")
      .insert({ user_id: user.id, name, token_hash: hashWorkerToken(token) })
      .select("id,name,created_at,last_seen_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ worker: data, token }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
