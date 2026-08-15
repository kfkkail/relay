import { createClient } from "@supabase/supabase-js";
import { requireServerSupabaseConfig } from "@/lib/env";

export function createAdminClient() {
  const { url, serviceRoleKey } = requireServerSupabaseConfig();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
