import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: process.env.RELAY_VEHICLES_PREVIEW === "1" ? false : undefined,
};

export default nextConfig;
