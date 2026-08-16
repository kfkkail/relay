export function hasPublicSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function requirePublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("Supabase public environment variables are not configured.");
  }
  return { url, publishableKey };
}

export function requireServerSupabaseConfig() {
  const { url } = requirePublicSupabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY is not configured.");
  }
  return { url, secretKey };
}

export function requireOwnerGitHubId() {
  const ownerGitHubId = process.env.RELAY_OWNER_GITHUB_ID;
  if (!ownerGitHubId || !/^\d+$/.test(ownerGitHubId)) {
    throw new Error("RELAY_OWNER_GITHUB_ID must be configured as a numeric GitHub user ID.");
  }
  return ownerGitHubId;
}
