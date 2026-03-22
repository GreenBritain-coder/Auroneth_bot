import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from './lib/auth';

// Ensure environment variables are available in middleware
// Next.js middleware runs on Edge runtime
export async function middleware(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  
  // Debug logging
  if (!token && request.nextUrl.pathname.startsWith('/admin')) {
    console.log('Middleware: No token cookie found');
  }

  // Allow access to login page and API routes
  const pathname = request.nextUrl.pathname;
  if (pathname === '/login' || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Protect admin routes
  if (pathname.startsWith('/admin')) {
    if (!token) {
      console.log('Middleware: No token found, redirecting to login');
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const payload = await verifyToken(token);
    if (!payload) {
      console.log('Middleware: Invalid token, redirecting to login');
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete('admin_token');
      return response;
    }

    // Check if user is trying to access super-admin only routes
    const superAdminRoutes = ['/admin/users-manage', '/admin/deploy-vendor', '/admin/bots/new'];
    if (superAdminRoutes.includes(pathname) && payload.role !== 'super-admin') {
      console.log('Middleware: Non-super-admin trying to access restricted route, redirecting');
      return NextResponse.redirect(new URL('/admin/bots', request.url));
    }
    
    console.log('Middleware: Token valid, allowing access to', pathname);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/login'],
};

