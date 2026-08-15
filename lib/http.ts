import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new ApiError("Sign in required.", 401);
  return { supabase, user };
}

export function apiErrorResponse(error: unknown) {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Unexpected error.";
  if (status === 500) console.error("Relay API error", error);
  return NextResponse.json({ error: message }, { status });
}
