import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  AUTH_RETURN_COOKIE,
  authReturnCookieOptions,
  authReturnPath,
} from "@/lib/auth-redirect";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin)
    return NextResponse.json(
      { error: "Invalid sign-in request." },
      { status: 403 },
    );
  try {
    const { next } = await request.json();
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${origin}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) throw new Error("OAuth initialization failed");
    const response = NextResponse.json({ url: data.url });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(
      AUTH_RETURN_COOKIE,
      authReturnPath(next),
      authReturnCookieOptions,
    );
    return response;
  } catch {
    return NextResponse.json(
      { error: "Could not start GitHub sign-in. Please try again." },
      { status: 503 },
    );
  }
}
