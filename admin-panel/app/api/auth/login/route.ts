import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { Admin, IAdmin } from '../../../../lib/models';
import bcrypt from 'bcryptjs';
import { generateToken } from '../../../../lib/auth';

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    // Find admin user - explicitly select all fields including role
    const admin = await Admin.findOne({ username }).lean() as IAdmin | null;

    if (!admin) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Verify password
    const isValid = await bcrypt.compare(password, admin.password_hash);

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Get the role - ensure we're reading it correctly
    const adminRole = admin.role || 'bot-owner';
    
    console.log('Login - Admin role from DB:', adminRole);
    console.log('Login - Full admin object:', admin);

    // Generate JWT token
    const token = await generateToken({
      username: admin.username,
      userId: admin._id.toString(),
      role: adminRole,
    });

    // Set cookie in response — httpOnly prevents XSS token theft
    const response = NextResponse.json({ success: true });
    response.cookies.set('admin_token', token, {
      path: '/',
      maxAge: 24 * 60 * 60, // 24 hours
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

