import { NextResponse } from 'next/server';

/**
 * Health check for Coolify/Traefik and load balancers.
 * Returns 200 so the proxy marks the container as healthy.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
