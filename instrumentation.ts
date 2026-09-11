import * as Sentry from '@sentry/nextjs';

export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({ dsn, tracesSampleRate: 0 });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({ dsn, tracesSampleRate: 0 });
  }
}

export const onRequestError = Sentry.captureRequestError;
