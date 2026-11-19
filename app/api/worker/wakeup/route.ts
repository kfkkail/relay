import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePublicSupabaseConfig } from "@/lib/env";
import { apiErrorResponse } from "@/lib/http";
import { requireWorker } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { worker } = await requireWorker(request);
    const signingSecret = process.env.SUPABASE_JWT_SECRET;
    const headers = { "Cache-Control": "no-store" };
    if (!signingSecret) return new NextResponse(null, { status: 204, headers });

    const { url, publishableKey } = requirePublicSupabaseConfig();
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + 300;
    const topic = `relay-worker-wakeup:${worker.user_id}`;
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    // Use the anon role so this token carries no signed-in user's API privileges.
    const claims = Buffer.from(
      JSON.stringify({
        role: "anon",
        aud: "authenticated",
        iat: issuedAt,
        exp: expiresAt,
        relay_worker_wakeup_topic: topic,
      }),
    );
    const unsigned = `${header.toString("base64url")}.${claims.toString("base64url")}`;
    const signature = createHmac("sha256", signingSecret)
      .update(unsigned)
      .digest("base64url");

    return NextResponse.json(
      {
        url,
        publishableKey,
        topic,
        token: `${unsigned}.${signature}`,
        expiresAt,
      },
      { headers },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
