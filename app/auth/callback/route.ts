import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  AUTH_RETURN_COOKIE,
  authReturnCookieOptions,
  authReturnPath,
} from "@/lib/auth-redirect";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();
  const destination = authReturnPath(
    cookieStore.get(AUTH_RETURN_COOKIE)?.value ??
      requestUrl.searchParams.get("next"),
  );
  let succeeded = false;
  const code = requestUrl.searchParams.get("code");
  if (code && !requestUrl.searchParams.has("error")) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      succeeded = !error;
    } catch {
      // Keep provider errors and authorization codes out of the UI and logs.
    }
  }
  const response = NextResponse.redirect(
    new URL(
      succeeded ? destination : "/my-work?auth_error=1",
      requestUrl.origin,
    ),
  );
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(AUTH_RETURN_COOKIE, "", {
    ...authReturnCookieOptions,
    maxAge: 0,
  });
  return response;
}
