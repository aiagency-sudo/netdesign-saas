import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/* are workspace TS sources built to dist/ by `pnpm run build`;
  // Next's default module resolution already follows workspace symlinks,
  // nothing extra needed here yet.
  //
  // @netdesign/config-gen loads its .njk template files from disk via a
  // runtime `fs` read (nunjucks.configure()), not an `import`/`require` —
  // Next's build-time file tracer can't see that, so the templates are
  // silently missing from the deployed serverless function bundle unless
  // explicitly declared here. The glob key needs its [id] segment escaped
  // — unescaped square brackets are a glob character class, not a literal
  // match, so "/api/projects/[id]/configs" alone silently matches nothing.
  outputFileTracingIncludes: {
    "/api/projects/\\[id\\]/configs": ["../../packages/config-gen/templates/**/*"],
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
