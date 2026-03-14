import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { Admin } from '../../../../lib/models';
import bcrypt from 'bcryptjs';
import { getTokenFromRequest, verifyToken } from '../../../../lib/auth';

// GET - Get specific admin user (super-admin only)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Only super-admins can view users
    if (payload.role !== 'super-admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectDB();
    const admin = await Admin.findById(params.id).select('-password_hash');

    if (!admin) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(admin);
  } catch (error) {
    console.error('Error fetching admin user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH - Update admin user (super-admin only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Only super-admins can update users
    if (payload.role !== 'super-admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await connectDB();
    const data = await request.json();

    const updateData: any = {};

    if (data.username) {
      // Check if username is already taken by another user
      const existing = await Admin.findOne({ 
        username: data.username, 
        _id: { $ne: params.id } 
      });
      if (existing) {
        return NextResponse.json(
          { error: 'Username already exists' },
          { status: 400 }
        );
      }
      updateData.username = data.username;
    }

    if (data.password) {
      updateData.password_hash = await bcrypt.hash(data.password, 10);
    }

    if (data.role) {
      if (data.role !== 'super-admin' && data.role !== 'bot-owner') {
        return NextResponse.json(
          { error: 'Invalid role. Must be "super-admin" or "bot-owner"' },
          { status: 400 }
        );
      }
      updateData.role = data.role;
    }

    const admin = await Admin.findByIdAndUpdate(
      params.id,
      { $set: updateData },
      { new: true }
    ).select('-password_hash');

    if (!admin) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(admin);
  } catch (error: any) {
    console.error('Error updating admin user:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete admin user (super-admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Only super-admins can delete users
    if (payload.role !== 'super-admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Prevent deleting yourself
    if (payload.userId === params.id) {
      return NextResponse.json(
        { error: 'Cannot delete your own account' },
        { status: 400 }
      );
    }

    await connectDB();
    const admin = await Admin.findByIdAndDelete(params.id);

    if (!admin) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting admin user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

