import { SignIn } from "@/components/sign-in";
import { SetupPanel } from "@/components/setup-panel";
import { Schedules } from "@/components/schedules";
import { hasPublicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!hasPublicSupabaseConfig()) return <SetupPanel />;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignIn />;
  return <Schedules />;
}
