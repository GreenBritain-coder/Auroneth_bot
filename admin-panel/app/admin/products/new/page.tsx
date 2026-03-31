'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewProductPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bots, setBots] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    base_price: '',
    currency: 'GBP',
    description: '',
    image_url: '',
    category_id: '',
    subcategory_id: '',
    bot_ids: [] as string[],
    unit: 'pcs',
    increment_amount: '',
    variations: [] as Array<{ name: string; price_modifier: number; stock?: number }>,
  });
  const [newVariation, setNewVariation] = useState({
    name: '',
    price_modifier: '',
    stock: '',
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    fetchBots();
    fetchCategories();
    fetchSubcategories();
  }, []);

  useEffect(() => {
    // When subcategory changes, filter bots and set category from subcategory
    if (formData.subcategory_id) {
      const subcategory = subcategories.find(s => s._id === formData.subcategory_id);
      if (subcategory) {
        const updates: Partial<typeof formData> = {};
        if (subcategory.bot_ids) updates.bot_ids = subcategory.bot_ids;
        if (subcategory.category_id) updates.category_id = subcategory.category_id;
        if (Object.keys(updates).length) setFormData(prev => ({ ...prev, ...updates }));
      }
    }
  }, [formData.subcategory_id]);

  const fetchBots = async () => {
    try {
      const response = await fetch('/api/bots');
      if (response.ok) {
        const json = await response.json();
        const botsArray = Array.isArray(json) ? json : (json.data || []);
        setBots(botsArray);
        // Default: check all bots
        if (botsArray.length > 0) {
          setFormData(prev => ({ ...prev, bot_ids: botsArray.map((b: any) => b._id) }));
        }
      }
    } catch (err) {
      console.error('Error fetching bots:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/categories/list', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setCategories(Array.isArray(data) ? data : []);
      } else {
        console.error('Categories fetch failed:', response.status);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const fetchSubcategories = async () => {
    try {
      const response = await fetch('/api/subcategories');
      if (response.ok) {
        const data = await response.json();
        setSubcategories(data);
      }
    } catch (err) {
      console.error('Error fetching subcategories:', err);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file');
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image size must be less than 5MB');
        return;
      }
      
      setImageFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
        // Convert to base64 data URL for storage
        setFormData({ ...formData, image_url: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData({ ...formData, image_url: '' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let imageUrl = formData.image_url;
      
      // If an image file was uploaded, convert to base64 data URL
      // (The preview already sets this, but we ensure it's set)
      if (imageFile && !imageUrl.startsWith('http')) {
        // Already converted to base64 in handleImageUpload
      }
      
      // Require either subcategory or category
      if (!formData.subcategory_id && !formData.category_id) {
        setError('Please select a category or subcategory');
        setLoading(false);
        return;
      }

      const productData = {
        name: formData.name,
        base_price: parseFloat(formData.base_price),
        currency: formData.currency,
        description: formData.description,
        image_url: imageUrl,
        category_id: formData.category_id || undefined,
        subcategory_id: formData.subcategory_id || '',
        bot_ids: formData.bot_ids,
        unit: formData.unit || 'pcs',
        increment_amount: formData.increment_amount ? parseFloat(formData.increment_amount) : undefined,
        variations: formData.variations.map(v => ({
          name: v.name,
          price_modifier: v.price_modifier,
          stock: v.stock ? parseInt(v.stock.toString()) : undefined,
        })),
      };

      const response = await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(productData),
      });

      if (response.ok) {
        router.push('/admin/products');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to create product');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBotToggle = (botId: string) => {
    setFormData((prev) => ({
      ...prev,
      bot_ids: prev.bot_ids.includes(botId)
        ? prev.bot_ids.filter((id) => id !== botId)
        : [...prev.bot_ids, botId],
    }));
  };

  const addVariation = () => {
    if (!newVariation.name || newVariation.price_modifier === '') {
      alert('Please fill in variation name and price');
      return;
    }
    const enteredPrice = parseFloat(newVariation.price_modifier) || 0;
    const basePrice = parseFloat(formData.base_price) || 0;
    setFormData(prev => ({
      ...prev,
      variations: [...prev.variations, {
        name: newVariation.name,
        price_modifier: enteredPrice - basePrice,
        stock: newVariation.stock ? parseInt(newVariation.stock) : undefined,
      }],
    }));
    setNewVariation({ name: '', price_modifier: '', stock: '' });
  };

  const removeVariation = (index: number) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations.filter((_, i) => i !== index),
    }));
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create New Product</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Product Name</label>
            <input
              type="text"
              required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Category</label>
            <select
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              value={formData.category_id}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
            >
              <option value="">Select a category (required if no subcategory)</option>
              {categories.map((cat) => (
                <option key={String(cat._id)} value={String(cat._id)}>
                  {cat.name || 'Unnamed'}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-gray-500">
              Required when no subcategory is selected. Products appear under this category in the shop.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Subcategory</label>
            <select
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              value={formData.subcategory_id}
              onChange={(e) => setFormData({ ...formData, subcategory_id: e.target.value })}
            >
              <option value="">None (use category only)</option>
              {subcategories.map((subcat) => (
                <option key={subcat._id} value={subcat._id}>
                  {subcat.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-gray-500">
              Optional. Create subcategories in Categories → [Category] → Subcategories
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Base Price *</label>
              <input
                type="number"
                step="0.00000001"
                required
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                value={formData.base_price}
                onChange={(e) => setFormData({ ...formData, base_price: e.target.value })}
              />
              <p className="mt-1 text-sm text-gray-500">Base price (variations add/subtract from this)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Currency</label>
              <select
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
              >
                <option value="GBP">GBP</option>
                <option value="BTC">BTC</option>
                <option value="USDT">USDT</option>
                <option value="LTC">LTC</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Unit *</label>
              <select
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
              >
                <option value="pcs">pcs (pieces) - for vapes, devices, count-based items</option>
                <option value="gr">gr (grams) - for weight-based items</option>
                <option value="kg">kg (kilograms) - for larger weight-based items</option>
                <option value="ml">ml (milliliters) - for liquid products</option>
              </select>
              <p className="mt-1 text-sm text-gray-500">Unit of measurement for quantity selection</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Increment Amount</label>
              <input
                type="number"
                step="0.01"
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                value={formData.increment_amount}
                onChange={(e) => setFormData({ ...formData, increment_amount: e.target.value })}
                placeholder="Auto (price-based)"
              />
              <p className="mt-1 text-sm text-gray-500">Amount for +/- buttons. Leave empty for automatic calculation.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              rows={4}
              required
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Product Image</label>
            
            {/* Image Preview */}
            {imagePreview && (
              <div className="mb-3 relative inline-block">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="h-32 w-32 object-cover rounded-md border border-gray-300"
                />
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="absolute top-0 right-0 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                >
                  ×
                </button>
              </div>
            )}
            
            {/* File Upload Input */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Upload Image
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-indigo-50 file:text-indigo-700
                  hover:file:bg-indigo-100
                  file:cursor-pointer"
              />
              <p className="mt-1 text-xs text-gray-500">
                Upload an image file (JPG, PNG, GIF) or enter a URL below (max 5MB)
              </p>
            </div>
            
            {/* URL Input (fallback) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Or enter Image URL
              </label>
              <input
                type="url"
                className="block w-full border border-gray-300 rounded-md px-3 py-2"
                value={formData.image_url && !imagePreview ? formData.image_url : ''}
                onChange={(e) => {
                  if (e.target.value && !e.target.value.startsWith('data:')) {
                    setImagePreview(e.target.value);
                    setFormData({ ...formData, image_url: e.target.value });
                  }
                }}
                placeholder="https://example.com/image.jpg"
                disabled={!!imageFile}
              />
              {imageFile && (
                <p className="mt-1 text-xs text-gray-500">
                  Clear uploaded image above to enter URL instead
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Product Variations</label>
            <div className="border border-gray-200 rounded-md p-4 space-y-4">
              {formData.variations.map((variation, index) => (
                <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded">
                  <div>
                    <span className="font-medium">{variation.name}</span>
                    <span className="ml-2 text-sm text-gray-600">
                      ({(parseFloat(formData.base_price) || 0) + variation.price_modifier} {formData.currency})
                    </span>
                    {variation.stock !== undefined && (
                      <span className="ml-2 text-sm text-gray-500">Stock: {variation.stock}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeVariation(index)}
                    className="text-red-600 hover:text-red-900 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
              
              <div className="grid grid-cols-4 gap-2">
                <input
                  type="text"
                  placeholder="Variation name"
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                  value={newVariation.name}
                  onChange={(e) => setNewVariation({ ...newVariation, name: e.target.value })}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Price for this option"
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                  value={newVariation.price_modifier}
                  onChange={(e) => setNewVariation({ ...newVariation, price_modifier: e.target.value })}
                />
                <input
                  type="number"
                  placeholder="Stock (optional)"
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                  value={newVariation.stock}
                  onChange={(e) => setNewVariation({ ...newVariation, stock: e.target.value })}
                />
                <button
                  type="button"
                  onClick={addVariation}
                  className="bg-indigo-600 text-white px-3 py-1 rounded-md text-sm hover:bg-indigo-700"
                >
                  Add
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Variations allow different sizes/options. Enter the full price for each option. Leave stock empty for unlimited.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assign to Bots</label>
            <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md p-3">
              {bots.map((bot) => (
                <label key={bot._id} className="flex items-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-indigo-600"
                    checked={formData.bot_ids.includes(bot._id)}
                    onChange={() => handleBotToggle(bot._id)}
                  />
                  <span className="ml-2 text-sm text-gray-700">{bot.name}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Bots are auto-selected based on subcategory. You can modify if needed.
            </p>
          </div>
        </div>

        <div className="mt-6 flex space-x-4">
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Product'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

