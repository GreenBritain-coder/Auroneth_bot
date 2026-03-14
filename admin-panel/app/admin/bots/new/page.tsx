'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewBotPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [hasBot, setHasBot] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    token: '',
    telegram_username: '',
    description: '',
    status: 'live',
    public_listing: true,
    main_buttons: 'Shop, Support, Promotions, Orders',
    welcome_message: '',
    thank_you_message: '',
    profile_picture_url: '',
  });

  useEffect(() => {
    // Check user role and existing bots
    const token = document.cookie
      .split('; ')
      .find(row => row.startsWith('admin_token='))
      ?.split('=')[1];
    
    let currentRole = 'bot-owner';
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentRole = payload.role || 'bot-owner';
        setUserRole(currentRole);
      } catch (e) {
        setUserRole('bot-owner');
      }
    } else {
      setUserRole('bot-owner');
    }

    // Check if user already has a bot (only for bot-owners, not super-admins)
    // Use currentRole from token, not state, to avoid race condition
    if (currentRole !== 'super-admin') {
      fetch('/api/bots')
        .then(res => res.json())
        .then(bots => {
          if (Array.isArray(bots) && bots.length > 0) {
            setHasBot(true);
            setError('You can only have one bot. Please delete your existing bot before creating a new one.');
          }
        })
        .catch(err => console.error('Error checking bots:', err));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Prevent submission if bot-owner already has a bot
    if (userRole !== 'super-admin' && hasBot) {
      setError('You can only have one bot. Please delete your existing bot before creating a new one.');
      return;
    }
    
    setLoading(true);

    try {
      // Parse main buttons (comma-separated)
      const main_buttons = formData.main_buttons
        .split(',')
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

      const botData = {
        name: formData.name,
        token: formData.token,
        telegram_username: formData.telegram_username.trim().replace('@', ''),
        description: formData.description,
        status: formData.status,
        public_listing: formData.public_listing,
        main_buttons,
        messages: {
          welcome: formData.welcome_message || 'Welcome!',
          thank_you: formData.thank_you_message || 'Thank you for your purchase!',
        },
        inline_buttons: {},
        products: [],
        profile_picture_url: formData.profile_picture_url || '',
      };

      const response = await fetch('/api/bots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(botData),
      });

      if (response.ok) {
        router.push('/admin/bots');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to create bot');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create New Bot</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Bot Name</label>
            <input
              type="text"
              required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Bot Token</label>
            <input
              type="text"
              required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              value={formData.token}
              onChange={(e) => setFormData({ ...formData, token: e.target.value })}
            />
            <p className="mt-1 text-sm text-gray-500">Get token from @BotFather on Telegram</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Telegram Bot Username</label>
            <input
              type="text"
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="mybot (without @)"
              value={formData.telegram_username}
              onChange={(e) => setFormData({ ...formData, telegram_username: e.target.value })}
            />
            <p className="mt-1 text-sm text-gray-500">
              Your bot's Telegram username (e.g., "mybot" for @mybot). Leave empty to use bot name as-is.
            </p>
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
            <label className="block text-sm font-medium text-gray-700">Main Menu Buttons</label>
            <input
              type="text"
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="Shop, Support, Promotions"
              value={formData.main_buttons}
              onChange={(e) => setFormData({ ...formData, main_buttons: e.target.value })}
            />
            <p className="mt-1 text-sm text-gray-500">Comma-separated list of button labels</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Welcome Message</label>
            <textarea
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              rows={3}
              placeholder="Welcome! Use {{secret_phrase}} to include user's secret phrase."
              value={formData.welcome_message}
              onChange={(e) => setFormData({ ...formData, welcome_message: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Thank You Message</label>
            <textarea
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              rows={2}
              value={formData.thank_you_message}
              onChange={(e) => setFormData({ ...formData, thank_you_message: e.target.value })}
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="public_listing"
              className="h-4 w-4 text-indigo-600"
              checked={formData.public_listing}
              onChange={(e) => setFormData({ ...formData, public_listing: e.target.checked })}
            />
            <label htmlFor="public_listing" className="ml-2 text-sm text-gray-700">
              Show on public front page
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Profile Picture (Optional)</label>
            <div className="mt-1 flex flex-wrap gap-2 items-start">
              <input
                type="url"
                className="flex-1 min-w-[200px] block border border-gray-300 rounded-md px-3 py-2"
                placeholder="https://example.com/bot-avatar.jpg or upload below"
                value={formData.profile_picture_url}
                onChange={(e) => setFormData({ ...formData, profile_picture_url: e.target.value })}
              />
              <label className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                      alert('Image must be under 2MB');
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      setFormData((prev) => ({ ...prev, profile_picture_url: reader.result as string }));
                    };
                    reader.readAsDataURL(file);
                    e.target.value = '';
                  }}
                />
                Upload Image
              </label>
            </div>
            {formData.profile_picture_url && (
              <div className="mt-2 flex items-center gap-2">
                <img
                  src={formData.profile_picture_url}
                  alt="Profile preview"
                  className="h-20 w-20 rounded-full object-cover border-2 border-gray-300"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, profile_picture_url: '' })}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            )}
            <p className="mt-1 text-sm text-gray-500">
              Enter a URL or upload an image (max 2MB). PNG, JPEG, GIF, WebP supported.
            </p>
          </div>
        </div>

        <div className="mt-6 flex space-x-4">
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Bot'}
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

