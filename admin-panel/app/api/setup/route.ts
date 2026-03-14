import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import { Admin } from '../../../lib/models';
import bcrypt from 'bcryptjs';

/**
 * One-time setup: create first admin user.
 * Call with: POST /api/setup
 * Body: { "username": "admin", "password": "YourPassword", "setupSecret": "YOUR_SETUP_SECRET" }
 *
 * Set SETUP_SECRET in Coolify env (e.g. a random string). Remove or leave empty after first use.
 */
export async function POST(request: NextRequest) {
  try {
    const { username, password, setupSecret } = await request.json();

    const expectedSecret = process.env.SETUP_SECRET || process.env.JWT_SECRET;
    if (!expectedSecret || setupSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid setup secret' }, { status: 403 });
    }

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    await connectDB();

    const existing = await Admin.findOne({ username });
    if (existing) {
      const password_hash = await bcrypt.hash(password, 10);
      await Admin.updateOne(
        { username },
        { $set: { password_hash, role: 'super-admin' } }
      );
      return NextResponse.json({
        success: true,
        message: `Admin "${username}" password updated. You can now log in.`,
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    await Admin.create({ username, password_hash, role: 'super-admin' });

    return NextResponse.json({
      success: true,
      message: `Admin "${username}" created. You can now log in.`,
    });
  } catch (error) {
    console.error('Setup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
