import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Relay — Tasks in motion",
    short_name: "Relay",
    description: "Capture a task on your phone, run it on your laptop, and keep the result attached.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f0e8",
    theme_color: "#f3f0e8",
    orientation: "portrait-primary",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
