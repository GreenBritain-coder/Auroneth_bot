import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '../../../../lib/auth';

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const payload = await verifyToken(token);

  if (!payload) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  return NextResponse.json({
    username: payload.username,
    userId: payload.userId,
    role: payload.role || 'bot-owner',
  });
}
