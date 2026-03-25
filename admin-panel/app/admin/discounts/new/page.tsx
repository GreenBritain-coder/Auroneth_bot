'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Bot {
  _id: string;
  name: string;
}

interface Product {
  _id: string;
  name: string;
}

export default function NewDiscountPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bots, setBots] = useState<Bot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [formData, setFormData] = useState({
    code: '',
    description: '',
    discount_type: 'percentage' as 'percentage' | 'fixed',
    discount_value: 10,
    bot_ids: [] as string[],
    applicable_product_ids: [] as string[],
    min_order_amount: '',
    max_discount_amount: '',
    usage_limit: '',
    valid_from: new Date().toISOString().split('T')[0],
    valid_until: '',
    active: true,
  });

  useEffect(() => {
    fetchBots();
    fetchProducts();
  }, []);

  const fetchBots = async () => {
    try {
      const response = await fetch('/api/bots');
      if (response.ok) {
        const data = await response.json();
        setBots(data);
      }
    } catch (err) {
      console.error('Error fetching bots:', err);
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/products');
      if (response.ok) {
        const data = await response.json();
        setProducts(data);
      }
    } catch (err) {
      console.error('Error fetching products:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = {
        ...formData,
        min_order_amount: formData.min_order_amount
          ? parseFloat(formData.min_order_amount)
          : undefined,
        max_discount_amount: formData.max_discount_amount
          ? parseFloat(formData.max_discount_amount)
          : undefined,
        usage_limit: formData.usage_limit
          ? parseInt(formData.usage_limit)
          : undefined,
      };

      const response = await fetch('/api/discounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        router.push('/admin/discounts');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to create discount');
      }
    } catch (err) {
      setError('Network error');
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

  const handleProductToggle = (productId: string) => {
    setFormData((prev) => ({
      ...prev,
      applicable_product_ids: prev.applicable_product_ids.includes(productId)
        ? prev.applicable_product_ids.filter((id) => id !== productId)
        : [...prev.applicable_product_ids, productId],
    }));
  };

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/discounts"
          className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
        >
          ← Back to Discounts
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-4">
          Create Discount Code
        </h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Discount Code *
            </label>
            <input
              type="text"
              required
              value={formData.code}
              onChange={(e) =>
                setFormData({ ...formData, code: e.target.value.toUpperCase() })
              }
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="SAVE10"
            />
            <p className="mt-1 text-sm text-gray-500">
              Code will be automatically converted to uppercase
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              rows={3}
              placeholder="Optional description for this discount"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Discount Type *
            </label>
            <select
              value={formData.discount_type}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  discount_type: e.target.value as 'percentage' | 'fixed',
                })
              }
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed Amount</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Discount Value *
            </label>
            <input
              type="number"
              required
              min="0"
              max={formData.discount_type === 'percentage' ? '100' : undefined}
              step={formData.discount_type === 'percentage' ? '1' : '0.01'}
              value={formData.discount_value}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  discount_value: parseFloat(e.target.value) || 0,
                })
              }
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder={
                formData.discount_type === 'percentage' ? '10' : '5.00'
              }
            />
            <p className="mt-1 text-sm text-gray-500">
              {formData.discount_type === 'percentage'
                ? 'Enter percentage (0-100)'
                : 'Enter fixed amount in GBP'}
            </p>
          </div>

          {formData.discount_type === 'percentage' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Maximum Discount Amount (Optional)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.max_discount_amount}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    max_discount_amount: e.target.value,
                  })
                }
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="50.00"
              />
              <p className="mt-1 text-sm text-gray-500">
                Maximum discount amount in GBP (e.g., cap at £50)
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Minimum Order Amount (Optional)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.min_order_amount}
              onChange={(e) =>
                setFormData({ ...formData, min_order_amount: e.target.value })
              }
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="20.00"
            />
            <p className="mt-1 text-sm text-gray-500">
              Minimum order amount required to use this discount
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Usage Limit (Optional)
            </label>
            <input
              type="number"
              min="1"
              value={formData.usage_limit}
              onChange={(e) =>
                setFormData({ ...formData, usage_limit: e.target.value })
              }
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="100"
            />
            <p className="mt-1 text-sm text-gray-500">
              Maximum number of times this code can be used (leave empty for unlimited)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Valid From *
            </label>
            <input
              type="date"
              required
              value={formData.valid_from}
              onChange={(e) =>
                setFormData({ ...formData, valid_from: e.target.value })
              }
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Valid Until *
            </label>
            <input
              type="date"
              required
              value={formData.valid_until}
              onChange={(e) =>
                setFormData({ ...formData, valid_until: e.target.value })
              }
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              min={formData.valid_from}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Apply to Bots
            </label>
            <div className="border border-gray-300 rounded-md p-3 max-h-48 overflow-y-auto">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, bot_ids: [] })}
                className="text-sm text-indigo-600 hover:text-indigo-900 mb-2"
              >
                {formData.bot_ids.length === 0
                  ? 'Select All'
                  : 'Clear Selection'}
              </button>
              {bots.map((bot) => (
                <label
                  key={bot._id}
                  className="flex items-center space-x-2 py-1"
                >
                  <input
                    type="checkbox"
                    checked={formData.bot_ids.includes(bot._id)}
                    onChange={() => handleBotToggle(bot._id)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-700">{bot.name}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Leave empty to apply to all bots
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Restrict to Products (Optional)
            </label>
            <div className="border border-gray-300 rounded-md p-3 max-h-48 overflow-y-auto">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, applicable_product_ids: [] })}
                className="text-sm text-indigo-600 hover:text-indigo-900 mb-2"
              >
                {formData.applicable_product_ids.length === 0 ? 'All Products' : 'Clear Selection'}
              </button>
              {products.map((product) => (
                <label key={product._id} className="flex items-center space-x-2 py-1">
                  <input
                    type="checkbox"
                    checked={formData.applicable_product_ids.includes(product._id)}
                    onChange={() => handleProductToggle(product._id)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-700">{product.name}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Leave empty to allow on all products. Select specific products to restrict usage.
            </p>
          </div>

          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) =>
                  setFormData({ ...formData, active: e.target.checked })
                }
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-gray-700">
                Active
              </span>
            </label>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => router.push('/admin/discounts')}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Discount'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

