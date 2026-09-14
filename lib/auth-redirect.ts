import { safeReturnPath } from "./routing";

export const AUTH_RETURN_COOKIE = "relay-auth-return";
export const authReturnCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/auth",
  maxAge: 600,
};

export function authReturnPath(value: unknown) {
  const path = safeReturnPath(
    typeof value === "string" ? value : null,
    "/my-work",
  );
  // Return only to dashboard routes, never back into the auth flow.
  if (
    !/^\/(tasks|my-work)(\/|\?|#|$)/.test(path) ||
    encodeURIComponent(path).length > 2048
  )
    return "/my-work";
  return path;
}
