"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Bell, ChevronDown, Laptop, Settings, X } from "lucide-react";
import { PushSettings } from "@/components/push-settings";
import { SignOutButton } from "@/components/sign-out-button";

export function SettingsMenu({
  userEmail,
  onWorkerSetup,
}: {
  userEmail: string;
  onWorkerSetup: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      ref={container}
      className="settings-menu"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="icon-button"
        aria-label="Settings"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <Settings size={20} />
      </button>
      <section
        id={id}
        className="settings-panel"
        aria-label="Settings"
        hidden={!open}
      >
        <div className="settings-heading">
          <h2>Settings</h2>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="settings-row"
          onClick={() => {
            setOpen(false);
            onWorkerSetup();
          }}
        >
          <Laptop size={20} />
          Worker setup
        </button>
        <Link className="settings-row" href="/schedules">
          Schedules
        </Link>
        <details className="settings-notifications">
          <summary className="settings-row">
            <Bell size={20} />
            <span>Notifications</span>
            <ChevronDown className="settings-chevron" size={18} />
          </summary>
          <PushSettings />
        </details>
        <div className="settings-sign-out">
          <SignOutButton userEmail={userEmail} showLabel />
        </div>
      </section>
    </div>
  );
}
