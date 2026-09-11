import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Keep errors only by default — no performance tracing or session replays
    // until we explicitly want them. They cost quota and risk PII leakage.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Don't drown the dashboard in errors from extensions / in-app browsers we
    // can't fix.
    ignoreErrors: [
      // Browser-extension noise
      'Host validation failed',
      'Host is not supported',
      'ResizeObserver loop',
      // WebGL fallback already handles this user-side — no point in logging.
      'Failed to initialize WebGL',
      'Could not create a WebGL context',
    ],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
