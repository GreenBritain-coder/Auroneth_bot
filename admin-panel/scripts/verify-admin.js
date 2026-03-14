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

async function verify() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'Admin123!';

  try {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/telegram_bot_platform';
    await mongoose.connect(uri);
    const dbName = mongoose.connection.db.databaseName;
    console.log('Connected to MongoDB, database:', dbName);

    const admin = await Admin.findOne({ username }).lean();
    if (!admin) {
      console.log('Admin user "' + username + '" NOT FOUND in collection "admins"');
      const count = await Admin.countDocuments();
      console.log('Total admins in collection:', count);
      process.exit(1);
    }

    console.log('Found admin:', { username: admin.username, role: admin.role });
    const isValid = await bcrypt.compare(password, admin.password_hash);
    console.log('Password match for "' + password + '":', isValid ? 'YES' : 'NO');
    process.exit(isValid ? 0 : 1);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verify();
