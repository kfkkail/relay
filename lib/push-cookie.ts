export const PUSH_DEVICE_COOKIE = "relay-push-device";
export const pushCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 365 * 24 * 60 * 60,
};
