import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@sim/engine", "@sim/content"],
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
