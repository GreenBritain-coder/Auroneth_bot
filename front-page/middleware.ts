import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const sessionCookie = request.cookies.get('shop_session_id');

  if (!sessionCookie) {
    const sessionId = crypto.randomUUID();
    response.cookies.set('shop_session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });
  }

  return response;
}

export const config = {
  matcher: '/shop/:path*',
};
