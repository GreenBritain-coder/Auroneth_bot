import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../lib/db';
import mongoose from 'mongoose';

/**
 * One-time migration import: accept JSON export and insert into MongoDB.
 * Protected by MIGRATE_SECRET or JWT_SECRET.
 *
 * POST /api/migrate-import
 * Headers: x-migrate-secret: YOUR_SECRET
 * Body: JSON from export_mongo_to_json.py { "collectionName": [ {...}, ... ] }
 */
export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-migrate-secret');
    const expected = process.env.MIGRATE_SECRET || process.env.JWT_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ error: 'Invalid or missing x-migrate-secret' }, { status: 403 });
    }

    const data = await request.json();
    if (typeof data !== 'object' || data === null) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    await connectDB();
    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json({ error: 'Database not connected' }, { status: 500 });
    }

    const order = [
      'admins', 'addresses', 'bots', 'categories', 'subcategories', 'products',
      'users', 'discounts', 'commissions', 'commissionpayments', 'commissionpayouts',
      'orders', 'invoices', 'contact_messages', 'carts', 'reviews', 'wishlists',
    ];

    let total = 0;
    const results: Record<string, number> = {};

    for (const collName of Object.keys(data)) {
      if (!Array.isArray(data[collName]) || data[collName].length === 0) continue;

      const coll = db.collection(collName);
      await coll.deleteMany({});
      const docs = data[collName].map((d: Record<string, unknown>) => {
        const doc = { ...d };
        if (doc._id && typeof doc._id === 'string' && /^[a-f0-9]{24}$/i.test(doc._id)) {
          doc._id = new mongoose.Types.ObjectId(doc._id);
        }
        return doc;
      });
      const r = await coll.insertMany(docs);
      const count = r.insertedCount;
      results[collName] = count;
      total += count;
    }

    return NextResponse.json({
      success: true,
      message: `Imported ${total} documents`,
      results,
    });
  } catch (error) {
    console.error('Migrate import error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
