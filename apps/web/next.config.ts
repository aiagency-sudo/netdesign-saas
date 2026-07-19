import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/* are workspace TS sources built to dist/ by `pnpm run build`;
  // Next's default module resolution already follows workspace symlinks,
  // nothing extra needed here yet.
};

export default nextConfig;
