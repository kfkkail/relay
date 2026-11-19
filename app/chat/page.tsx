import { SignIn } from "@/components/sign-in";
import { SetupPanel } from "@/components/setup-panel";
import { Chat } from "@/components/chat";
import { hasPublicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; new?: string }>;
}) {
  if (!hasPublicSupabaseConfig()) return <SetupPanel />;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignIn />;
  const params = await searchParams;
  const id =
    params.id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      params.id,
    )
      ? params.id
      : null;
  const isNew = params.new === "1";
  return (
    <Chat
      key={id ?? (isNew ? "new" : "list")}
      initialId={id}
      initialNew={isNew}
      userEmail={user.email ?? ""}
    />
  );
}
