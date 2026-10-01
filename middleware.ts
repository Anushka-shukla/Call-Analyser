import { withAuth } from 'next-auth/middleware';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

const auth = withAuth({ pages: { signIn: '/login' } });

// Every page and /api/recording needs a login. Cron, webhook and auth routes have their own checks.
export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  if (process.env.AUTH_DISABLED === 'true') return NextResponse.next();
  return (auth as any)(req, ev);
}

export const config = {
  matcher: ['/((?!api/auth|api/cron|api/exotel|login|_next/static|_next/image|favicon.ico).*)'],
};
