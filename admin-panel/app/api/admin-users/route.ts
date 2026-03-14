import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../lib/db';
import { Admin } from '../../lib/models';
import bcrypt from 'bcryptjs';
import { getTokenFromRequest, verifyToken } from '../../lib/auth';

// GET - List all admin users (super-admin only)
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Only super-admins can list users
    if (payload.role !== 'super-admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectDB();
    const admins = await Admin.find({}).select('-password_hash').sort({ created_at: -1 });
    
    return NextResponse.json(admins);
  } catch (error) {
    console.error('Error fetching admin users:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create new admin user (super-admin only)
export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Only super-admins can create users
    if (payload.role !== 'super-admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectDB();
    const data = await request.json();

    const { username, password, role } = data;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    if (role && role !== 'super-admin' && role !== 'bot-owner') {
      return NextResponse.json(
        { error: 'Invalid role. Must be "super-admin" or "bot-owner"' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existing = await Admin.findOne({ username });
    if (existing) {
      return NextResponse.json(
        { error: 'Username already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create admin
    const admin = new Admin({
      username,
      password_hash,
      role: role || 'bot-owner',
    });

    await admin.save();

    // Return admin without password hash
    const adminResponse = admin.toObject();
    delete adminResponse.password_hash;

    return NextResponse.json(adminResponse, { status: 201 });
  } catch (error: any) {
    console.error('Error creating admin user:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

