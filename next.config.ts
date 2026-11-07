import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  experimental: {
    serverActions: { bodySizeLimit: "8mb" }, // photo-of-list uploads
  },
};

export default nextConfig;
