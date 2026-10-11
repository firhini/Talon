import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native sqlite binding and the workspace package must be loaded by Node at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3", "@talon/core"],
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
};

export default nextConfig;
