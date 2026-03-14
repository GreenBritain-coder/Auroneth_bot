import mongoose, { Schema, Document } from 'mongoose';

export interface IBot extends Document {
  _id: string;
  name: string;
  description?: string;
  status: 'live' | 'offline';
  public_listing: boolean;
  profile_picture_url?: string;
  categories?: string[];
  featured?: boolean;
  payment_methods?: string[]; // Supported payment methods (e.g., ["BTC", "LTC"])
  cut_off_time?: string; // Cut-off time in HH:MM format (e.g., "14:30")
}

const BotSchema = new Schema<IBot>({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['live', 'offline'], default: 'live' },
  public_listing: { type: Boolean, default: true },
  profile_picture_url: { type: String, default: '' },
  categories: { type: [String], default: [] },
  featured: { type: Boolean, default: false },
  payment_methods: { type: [String], default: ['BTC', 'LTC'] }, // Supported payment methods (BTC/LTC only)
}, { strict: false }); // Allow additional fields beyond schema

// Delete existing model if it exists to force schema refresh
if (mongoose.models.Bot) {
  delete mongoose.models.Bot;
}
export const Bot = mongoose.model<IBot>('Bot', BotSchema);

