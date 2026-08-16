import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { requireOwnerGitHubId } from "@/lib/env";
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
  if (!isRelayOwner(user)) throw new ApiError("This Relay deployment is private.", 403);
  return { supabase, user };
}

export function isRelayOwner(user: User) {
  const ownerGitHubId = requireOwnerGitHubId();
  return user.identities?.some((identity) =>
    identity.provider === "github" &&
    String(identity.identity_data?.provider_id ?? identity.id) === ownerGitHubId
  ) ?? false;
}

export function apiErrorResponse(error: unknown) {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Unexpected error.";
  if (status === 500) console.error("Relay API error", error);
  return NextResponse.json({ error: message }, { status });
}
