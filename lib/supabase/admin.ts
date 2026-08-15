import { createClient } from "@supabase/supabase-js";
import { requireServerSupabaseConfig } from "@/lib/env";

export function createAdminClient() {
  const { url, secretKey } = requireServerSupabaseConfig();
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
