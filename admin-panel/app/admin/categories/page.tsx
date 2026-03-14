'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Category {
  _id: string;
  name: string;
  description?: string;
  bot_ids: string[];
  order: number;
  orderCount?: number;
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/categories');
      if (response.ok) {
        const data = await response.json();
        setCategories(data);
      } else {
        setError('Failed to fetch categories');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (categoryId: string) => {
    if (!confirm('Are you sure you want to delete this category?')) {
      return;
    }

    try {
      const response = await fetch(`/api/categories/${categoryId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchCategories();
      } else {
        alert('Failed to delete category');
      }
    } catch (err) {
      alert('Network error');
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
        <Link
          href="/admin/categories/new"
          className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
        >
          Add New Category
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {categories.map((category) => (
            <li key={category._id}>
              <div className="px-4 py-4 sm:px-6 flex justify-between items-center">
                <div className="flex-1">
                  <div className="flex items-center">
                    <h3 className="text-lg font-medium text-gray-900">{category.name}</h3>
                    <span className="ml-2 text-sm text-gray-500">(Order: {category.order})</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{category.description || 'No description'}</p>
                  <div className="mt-1 text-xs text-gray-400 space-x-3">
                    <span>Assigned to {category.bot_ids?.length || 0} bot(s)</span>
                    <span>•</span>
                    <span>{category.orderCount || 0} order{(category.orderCount || 0) !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Link
                    href={`/admin/categories/${category._id}`}
                    className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
                  >
                    Edit
                  </Link>
                  <Link
                    href={`/admin/categories/${category._id}/subcategories`}
                    className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                  >
                    Subcategories
                  </Link>
                  <button
                    onClick={() => handleDelete(category._id)}
                    className="text-red-600 hover:text-red-900 text-sm font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {categories.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">
            No categories found. Create your first category to get started.
          </div>
        )}
      </div>
    </div>
  );
}

