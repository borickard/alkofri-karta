import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const domain = process.env.PLAUSIBLE_DOMAIN;
  if (!domain) return NextResponse.json({ ok: false });

  const body = await req.json();
  const { name, url, props } = body;
  if (!name || !url) return NextResponse.json({ ok: false });

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1';
  const ua = req.headers.get('user-agent') ?? '';

  await fetch('https://plausible.io/api/event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ua,
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify({
      name,
      url,
      domain,
      ...(props ? { props } : {}),
    }),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
