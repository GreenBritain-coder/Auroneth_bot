import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';

// Validate JWT_SECRET at module load time — refuse to operate without a strong secret
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    'FATAL: JWT_SECRET environment variable is not set. ' +
    'The admin panel cannot start without it. ' +
    'Set JWT_SECRET to a strong random value of at least 32 characters.'
  );
}

if (JWT_SECRET.length < 32) {
  throw new Error(
    'FATAL: JWT_SECRET must be at least 32 characters long. ' +
    'Current length: ' + JWT_SECRET.length + '. ' +
    'Use a cryptographically random string (e.g., openssl rand -base64 48).'
  );
}

export interface TokenPayload {
  username: string;
  userId: string;
  role?: 'super-admin' | 'bot-owner' | 'demo';
}

// Get secret key for jose
function getSecretKey() {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return secret;
}

export async function generateToken(payload: TokenPayload): Promise<string> {
  const secretKey = getSecretKey();
  const token = await new SignJWT({
    username: payload.username,
    userId: payload.userId,
    role: payload.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(secretKey);
  return token;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as TokenPayload;
  } catch (error: any) {
    console.error('Token verification error:', error.message);
    return null;
  }
}

export function getTokenFromRequest(request: NextRequest): string | null {
  // Try to get token from Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Try to get token from cookie
  const token = request.cookies.get('admin_token')?.value;
  return token || null;
}

