const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['super-admin', 'bot-owner'], default: 'bot-owner' },
  created_at: { type: Date, default: Date.now },
});

const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);

async function createAdmin() {
  const args = process.argv.slice(2);
  const username = args[0];
  const password = args[1];
  const role = args[2] || 'bot-owner'; // Optional role, defaults to bot-owner

  if (!username || !password) {
    console.error('Usage: node create-admin.js <username> <password> [role]');
    console.error('  role: super-admin or bot-owner (default: bot-owner)');
    process.exit(1);
  }

  if (role !== 'super-admin' && role !== 'bot-owner') {
    console.error('Error: role must be either "super-admin" or "bot-owner"');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/telegram_bot_platform');
    console.log('Connected to MongoDB');

    // Check if admin exists
    const existing = await Admin.findOne({ username });
    if (existing) {
      console.log(`Admin user "${username}" already exists. Updating password and role...`);
      // Update password and role
      const password_hash = await bcrypt.hash(password, 10);
      await Admin.updateOne({ username }, { $set: { password_hash, role } });
      console.log(`Password and role updated for "${username}"! Role: ${role}`);
      process.exit(0);
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create admin
    const admin = new Admin({
      username,
      password_hash,
      role,
    });

    await admin.save();
    console.log(`Admin user "${username}" created successfully! Role: ${role}`);
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
}

createAdmin();

