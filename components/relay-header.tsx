import Link from "next/link";
import { SettingsMenu } from "@/components/settings-menu";
import { Settings } from "lucide-react";

export function RelayHeader({
  userEmail,
  active,
  preview = false,
}: {
  userEmail: string;
  active?: "my-work" | "tasks" | "schedules";
  preview?: boolean;
}) {
  return (
    <header className="topbar">
      <Link href="/my-work" className="brand-lockup">
        <span className="brand-mark">R</span>
        <span>Relay</span>
      </Link>
      <nav className="area-nav" aria-label="Main navigation">
        <Link
          href="/my-work"
          aria-current={active === "my-work" ? "page" : undefined}
        >
          My Work
        </Link>
        <Link
          href="/tasks"
          aria-current={active === "tasks" ? "page" : undefined}
        >
          Tasks
        </Link>
        <Link
          href="/schedules"
          aria-current={active === "schedules" ? "page" : undefined}
        >
          Schedules
        </Link>
      </nav>
      <div className="topbar-actions">
        {preview ? (
          <button
            className="icon-button"
            disabled
            aria-label="Account settings unavailable in sample"
            title="Global account actions are disabled in this sample"
          >
            <Settings size={20} />
          </button>
        ) : (
          <SettingsMenu userEmail={userEmail} />
        )}
      </div>
    </header>
  );
}
