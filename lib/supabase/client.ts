import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseConfig } from "@/lib/env";

export function createClient() {
  const { url, anonKey } = requirePublicSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
