import { SignIn } from "@/components/sign-in";
import { SetupPanel } from "@/components/setup-panel";
import { Chat } from "@/components/chat";
import { hasPublicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  if (!hasPublicSupabaseConfig()) return <SetupPanel />;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignIn />;
  const { id } = await searchParams;
  return <Chat initialId={id && /^[0-9a-f-]{36}$/i.test(id) ? id : null} />;
}
