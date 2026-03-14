const mongoose = require('mongoose');
require('dotenv').config();

const BotSchema = new mongoose.Schema({
  token: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  main_buttons: { type: [String], default: [] },
  inline_buttons: { type: mongoose.Schema.Types.Mixed, default: {} },
  messages: { type: mongoose.Schema.Types.Mixed, default: {} },
  products: { type: [String], default: [] },
  status: { type: String, enum: ['live', 'offline'], default: 'live' },
  owner: { type: String },
  public_listing: { type: Boolean, default: true },
  profile_picture_url: { type: String, default: '' },
});

const Bot = mongoose.models.Bot || mongoose.model('Bot', BotSchema);

async function createBot() {
  const args = process.argv.slice(2);
  const token = args[0];
  const name = args[1] || 'Auroneth.bot';

  if (!token) {
    console.error('Usage: node create-bot.js <token> [name]');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/telegram_bot_platform');
    console.log('Connected to MongoDB');

    // Check if bot exists with this token
    const existing = await Bot.findOne({ token });
    if (existing) {
      console.log(`Bot with this token already exists:`);
      console.log(`  Name: ${existing.name}`);
      console.log(`  ID: ${existing._id}`);
      console.log(`  Status: ${existing.status}`);
      console.log('\nUpdating name if needed...');
      existing.name = name;
      await existing.save();
      console.log(`Bot updated!`);
      process.exit(0);
    }

    // Check if bot exists with this name but different token
    const existingByName = await Bot.findOne({ name });
    if (existingByName) {
      console.log(`Bot with name "${name}" exists but has different token.`);
      console.log(`Updating token...`);
      existingByName.token = token;
      await existingByName.save();
      console.log(`Bot token updated!`);
      process.exit(0);
    }

    // Create new bot
    const bot = new Bot({
      token,
      name,
      description: 'Telegram bot for Auroneth',
      main_buttons: ['Shop', 'Support'],
      status: 'live',
      public_listing: true,
      messages: {
        welcome: 'Welcome! Your secret phrase is: {{secret_phrase}}',
        thank_you: 'Thank you for your purchase!',
      },
    });

    await bot.save();
    console.log(`Bot "${name}" created successfully!`);
    console.log(`  Token: ${token}`);
    console.log(`  ID: ${bot._id}`);
    console.log(`  Status: ${bot.status}`);
    process.exit(0);
  } catch (error) {
    console.error('Error creating bot:', error);
    process.exit(1);
  }
}

createBot();

