import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg", "postgres"],
  experimental: {
    typedEnv: true,
  },
};

export default nextConfig;
