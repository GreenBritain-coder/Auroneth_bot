import { NextResponse } from 'next/server';
import { TokenPayload } from './auth';

export function demoWriteBlocked(payload: TokenPayload): NextResponse | null {
  if (payload.role === 'demo') {
    return NextResponse.json(
      { error: 'Demo mode — changes not saved' },
      { status: 403 }
    );
  }
  return null;
}
