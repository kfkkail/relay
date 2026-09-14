import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

import { ApiError } from "./api-error";
export { ApiError } from "./api-error";

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
