import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';

// Use explicit secret - ensure it's available in both API routes and middleware
const JWT_SECRET = process.env.JWT_SECRET || 'local-testing-secret-key-change-in-production';

export interface TokenPayload {
  username: string;
  userId: string;
  role?: 'super-admin' | 'bot-owner';
}

// Get secret key for jose
function getSecretKey() {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return secret;
}

export async function generateToken(payload: TokenPayload): Promise<string> {
  const secretKey = getSecretKey();
  const token = await new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(secretKey);
  return token;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const secret = process.env.JWT_SECRET || 'local-testing-secret-key-change-in-production';
    
    if (!secret || secret === 'your-secret-key-change-in-production') {
      console.error('JWT_SECRET is not properly configured!');
      return null;
    }
    
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

