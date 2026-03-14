'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Subcategory {
  _id: string;
  name: string;
  description?: string;
  category_id: string;
  bot_ids: string[];
  order: number;
  orderCount?: number;
}

export default function SubcategoriesPage() {
  const params = useParams();
  const router = useRouter();
  const categoryId = params?.id as string;
  const [category, setCategory] = useState<any>(null);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (categoryId) {
      fetchCategory();
      fetchSubcategories();
    }
  }, [categoryId]);

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

  const fetchSubcategories = async () => {
    try {
      const response = await fetch(`/api/subcategories?category_id=${categoryId}`);
      if (response.ok) {
        const data = await response.json();
        setSubcategories(data);
      } else {
        setError('Failed to fetch subcategories');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (subcategoryId: string) => {
    if (!confirm('Are you sure you want to delete this subcategory?')) {
      return;
    }

    try {
      const response = await fetch(`/api/subcategories/${subcategoryId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchSubcategories();
      } else {
        alert('Failed to delete subcategory');
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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Subcategories
            {category && <span className="text-lg font-normal text-gray-600"> - {category.name}</span>}
          </h1>
          <Link href="/admin/categories" className="text-sm text-indigo-600 hover:text-indigo-900">
            ← Back to Categories
          </Link>
        </div>
        <Link
          href={`/admin/categories/${categoryId}/subcategories/new`}
          className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
        >
          Add New Subcategory
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {subcategories.map((subcategory) => (
            <li key={subcategory._id}>
              <div className="px-4 py-4 sm:px-6 flex justify-between items-center">
                <div className="flex-1">
                  <div className="flex items-center">
                    <h3 className="text-lg font-medium text-gray-900">{subcategory.name}</h3>
                    <span className="ml-2 text-sm text-gray-500">(Order: {subcategory.order})</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{subcategory.description || 'No description'}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {subcategory.orderCount || 0} order{(subcategory.orderCount || 0) !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex space-x-2">
                  <Link
                    href={`/admin/categories/${categoryId}/subcategories/${subcategory._id}`}
                    className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(subcategory._id)}
                    className="text-red-600 hover:text-red-900 text-sm font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {subcategories.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">
            No subcategories found. Create your first subcategory to get started.
          </div>
        )}
      </div>
    </div>
  );
}

