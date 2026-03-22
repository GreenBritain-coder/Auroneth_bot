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
  web_shop_enabled?: boolean;
  web_shop_slug?: string;
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
  web_shop_enabled: { type: Boolean, default: false },
  web_shop_slug: { type: String, default: '' },
}, { strict: false }); // Allow additional fields beyond schema

// Delete existing model if it exists to force schema refresh
if (mongoose.models.Bot) {
  delete mongoose.models.Bot;
}
export const Bot = mongoose.model<IBot>('Bot', BotSchema);

// Category Model
export interface ICategory extends Document {
  _id: string;
  name: string;
  description?: string;
  bot_ids: string[];
  order: number;
}

const CategorySchema = new Schema<ICategory>({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  bot_ids: { type: [String], default: [] },
  order: { type: Number, default: 0 },
});

export const Category = mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema);

// Subcategory Model
export interface ISubcategory extends Document {
  _id: string;
  name: string;
  description?: string;
  category_id: string;
  bot_ids: string[];
  order: number;
}

const SubcategorySchema = new Schema<ISubcategory>({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  category_id: { type: String, required: true },
  bot_ids: { type: [String], default: [] },
  order: { type: Number, default: 0 },
});

export const Subcategory = mongoose.models.Subcategory || mongoose.model<ISubcategory>('Subcategory', SubcategorySchema);

// Product Model
export interface IProduct extends Document {
  _id: string;
  name: string;
  base_price: number;
  price?: number; // Legacy field for backward compatibility
  currency: string;
  description: string;
  image_url?: string;
  subcategory_id: string;
  category_id?: string;
  bot_ids: string[];
  unit?: string;
  increment_amount?: number;
  variations?: Array<{
    name: string;
    price_modifier: number;
    stock?: number;
  }>;
}

const ProductSchema = new Schema<IProduct>({
  name: { type: String, required: true },
  base_price: { type: Number },
  price: { type: Number },
  currency: { type: String, required: true },
  description: { type: String, required: true },
  image_url: { type: String, default: '' },
  subcategory_id: { type: String, default: '' },
  category_id: { type: String, default: '' },
  bot_ids: { type: [String], default: [] },
  unit: { type: String, default: 'pcs' },
  increment_amount: { type: Number },
  variations: { type: [Schema.Types.Mixed], default: [] },
});

export const Product = mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);

