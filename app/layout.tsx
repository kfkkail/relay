import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay — Tasks in motion",
  description:
    "Capture a task on your phone, run it on your laptop, and keep the result attached.",
  applicationName: "Relay",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Relay",
  },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f0e8" },
    { media: "(prefers-color-scheme: dark)", color: "#111714" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <main className="launch-splash launch-splash--initial" aria-busy="true">
          <div
            className="launch-splash__content"
            role="status"
            aria-live="polite"
          >
            <div className="launch-splash__mark" aria-hidden="true">
              R
            </div>
            <div className="launch-splash__indicator" aria-hidden="true" />
            <p>Loading your Relay…</p>
          </div>
        </main>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
