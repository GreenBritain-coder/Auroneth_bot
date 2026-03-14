const mongoose = require('mongoose');
require('dotenv').config();

const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['super-admin', 'bot-owner'], default: 'bot-owner' },
  created_at: { type: Date, default: Date.now },
});

const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);

async function checkAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/telegram_bot_platform');
    console.log('Connected to MongoDB');
    console.log('');

    const admins = await Admin.find({}).select('-password_hash');
    
    console.log('All admin users:');
    console.log('================');
    admins.forEach(admin => {
      console.log(`Username: ${admin.username}`);
      console.log(`Role: ${admin.role}`);
      console.log(`ID: ${admin._id}`);
      console.log(`Created: ${admin.created_at}`);
      console.log('');
    });

    const superadmin = await Admin.findOne({ username: 'superadmin' });
    if (superadmin) {
      console.log('superadmin user details:');
      console.log(`  Role: ${superadmin.role}`);
      console.log(`  Role type: ${typeof superadmin.role}`);
      console.log(`  Role value: "${superadmin.role}"`);
    } else {
      console.log('superadmin user NOT FOUND!');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAdmin();

