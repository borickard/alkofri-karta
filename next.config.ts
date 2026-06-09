import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Sentry wrapping is a no-op at runtime when SENTRY_DSN isn't set; the only
// build-time effect is the SDK auto-instrumentation. Source-map upload is
// skipped unless SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT are present.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  // Bypass ad-blockers (ERR_BLOCKED_BY_CLIENT on *.ingest.sentry.io).
  // The client SDK posts to /monitoring on our own domain; the auto-generated
  // route forwards envelopes to Sentry server-side.
  tunnelRoute: '/monitoring',
});
