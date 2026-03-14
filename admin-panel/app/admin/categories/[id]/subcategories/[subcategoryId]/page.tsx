'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function EditSubcategoryPage() {
  const router = useRouter();
  const params = useParams();
  const categoryId = params?.id as string;
  const subcategoryId = params?.subcategoryId as string;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [bots, setBots] = useState<any[]>([]);
  const [category, setCategory] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    order: 0,
    bot_ids: [] as string[],
  });

  useEffect(() => {
    if (subcategoryId && categoryId) {
      fetchSubcategory();
      fetchCategory();
      fetchBots();
    }
  }, [subcategoryId, categoryId]);

  const fetchSubcategory = async () => {
    try {
      const response = await fetch(`/api/subcategories/${subcategoryId}`);
      if (response.ok) {
        const data = await response.json();
        setFormData({
          name: data.name || '',
          description: data.description || '',
          order: data.order || 0,
          bot_ids: data.bot_ids || [],
        });
      } else {
        setError('Failed to load subcategory');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategory = async () => {
    try {
      const response = await fetch(`/api/categories/${categoryId}`);
      if (response.ok) {
        const data = await response.json();
        setCategory(data);
      }
    } catch (err) {
      console.error('Failed to fetch category:', err);
    }
  };

  const fetchBots = async () => {
    try {
      const response = await fetch('/api/bots');
      if (response.ok) {
        const data = await response.json();
        setBots(data);
      }
    } catch (err) {
      console.error('Failed to fetch bots:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const response = await fetch(`/api/subcategories/${subcategoryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        router.push(`/admin/categories/${categoryId}/subcategories`);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to update subcategory');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleBot = (botId: string) => {
    setFormData({
      ...formData,
      bot_ids: formData.bot_ids.includes(botId)
        ? formData.bot_ids.filter(id => id !== botId)
        : [...formData.bot_ids, botId],
    });
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Edit Subcategory
        {category && <span className="text-lg font-normal text-gray-600"> - {category.name}</span>}
      </h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Subcategory Name *</label>
            <input
              type="text"
              required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Display Order</label>
            <input
              type="number"
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              value={formData.order}
              onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
            />
            <p className="mt-1 text-sm text-gray-500">Lower numbers appear first</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assign to Bots</label>
            <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-md p-3">
              {bots.map((bot) => (
                <label key={bot._id} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.bot_ids.includes(bot._id)}
                    onChange={() => toggleBot(bot._id)}
                    className="h-4 w-4 text-indigo-600"
                  />
                  <span className="ml-2 text-sm text-gray-700">{bot.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex space-x-4">
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
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

