import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function unauthorized(realm: string) {
  return new NextResponse('Auth required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
    },
  });
}

export function middleware(req: NextRequest) {
  const realm = process.env.ADMIN_REALM || 'Admin';
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || '';

  // If not configured, block (safer default)
  if (!adminPass) return unauthorized(realm);

  const auth = req.headers.get('authorization');
  if (!auth || !auth.toLowerCase().startsWith('basic ')) {
    return unauthorized(realm);
  }

  const base64 = auth.slice(6).trim();
  let decoded = '';
  try {
    decoded = Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return unauthorized(realm);
  }

  const [user, pass] = decoded.split(':');

  if (user !== adminUser || pass !== adminPass) {
    return unauthorized(realm);
  }

  return NextResponse.next();
}

// Skydda /admin och /api/admin/*
export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};