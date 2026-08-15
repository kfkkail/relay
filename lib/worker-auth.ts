import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export function hashWorkerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireWorker(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer relay_")) {
    throw new ApiError("Valid worker bearer token required.", 401);
  }

  const tokenHash = hashWorkerToken(authorization.slice("Bearer ".length));
  const supabase = createAdminClient();
  const { data: worker, error } = await supabase
    .from("workers")
    .select("id,user_id,name")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !worker) throw new ApiError("Worker token is invalid or revoked.", 401);

  await supabase.from("workers").update({ last_seen_at: new Date().toISOString() }).eq("id", worker.id);
  return { supabase, worker };
}
