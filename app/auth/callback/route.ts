import { NextResponse } from "next/server";
import { isRelayOwner } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { data } = await supabase.auth.exchangeCodeForSession(code);
    if (data.user && !isRelayOwner(data.user)) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/?authError=private", requestUrl.origin));
    }
  }
  return NextResponse.redirect(new URL("/", requestUrl.origin));
}
