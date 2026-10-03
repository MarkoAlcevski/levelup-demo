import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic gate only: no session cookie → straight to /login without rendering the app.
 * Real authorization happens in every page, action and route (and in Postgres via RLS).
 */
const APP_PATHS = ['/today', '/areas', '/gym', '/learning', '/groups', '/money', '/progress', '/journal', '/profile', '/quests', '/review', '/onboarding', '/plan', '/you'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (APP_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/')) && !req.cookies.has('kept_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // come back to invite links after signing in
    if (pathname.startsWith('/groups/join/')) url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon|icon|apple-icon|manifest|sw.js).*)'],
};
