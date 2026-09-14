"use client";
import { FormEvent, useState } from "react";
import { LogOut } from "lucide-react";
import { signOutDevice } from "@/lib/sign-out-device";

export function SignOutButton({
  userEmail,
  showLabel = false,
}: {
  userEmail: string;
  showLabel?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signOutDevice();
      // Discard cached signed-in task data with a full navigation after logout.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch {
      setError("Could not sign out. Please try again.");
      setBusy(false);
    }
  }
  return (
    <form action="/auth/sign-out" method="post" onSubmit={submit}>
      <button
        className={showLabel ? "settings-row" : "icon-button"}
        disabled={busy}
        aria-label={`Sign out ${userEmail}`}
      >
        <LogOut size={19} />
        {showLabel && (busy ? "Signing out…" : "Sign out")}
      </button>
      {error && <span role="alert">{error}</span>}
    </form>
  );
}
