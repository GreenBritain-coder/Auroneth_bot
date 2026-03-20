'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { CATEGORIES, getEmojisFromValues, getValuesFromEmojis } from '../../../../lib/categories';

export default function EditBotPage() {
  const router = useRouter();
  const params = useParams();
  const botId = params?.id as string;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [bot, setBot] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    token: '',
    telegram_username: '',
    description: '',
    status: 'live',
    public_listing: true,
    main_buttons: '',
    welcome_message: '',
    thank_you_message: '',
    support_message: '',
    promotions_message: '',
    profile_picture_url: '',
    inline_action_info: '',
    main_button_messages: {} as Record<string, string>,
    menu_inline_buttons: '' as string, // JSON string for menu inline buttons
    categories: [] as string[],
    featured: false,
    cut_off_time: '', // Cut-off time in HH:MM format (e.g., "14:30")
    routes: '', // Shipping routes
    language: '', // Language
    website_url: '', // Official website URL
    instagram_url: '', // Instagram URL
    telegram_channel: '', // Telegram channel (without @)
    telegram_group: '', // Telegram group (without @)
    rating: '', // Rating percentage
    rating_count: '', // Number of ratings
    vendor_pgp_key: '', // Vendor PGP key
    payment_methods: ['BTC', 'LTC'] as string[], // Supported payment methods (BTC/LTC only)
    payout_ltc_address: '', // Vendor's LTC payout address
    payout_btc_address: '', // Vendor's BTC payout address
    shipping_methods: { STD: 0, EXP: 5, NXT: 10 } as Record<string, number>, // Delivery method costs (Standard, Express, Next Day)
  });
  const [updatingProfilePic, setUpdatingProfilePic] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    // Get user role from token
    const token = document.cookie
      .split('; ')
      .find(row => row.startsWith('admin_token='))
      ?.split('=')[1];
    
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserRole(payload.role || 'bot-owner');
      } catch (e) {
        console.error('Error decoding token:', e);
      }
    }
    
    if (botId) {
      fetchBot();
    }
  }, [botId]);

  const fetchBot = async () => {
    try {
      const response = await fetch(`/api/bots/${botId}`);
      if (response.ok) {
        const botData = await response.json();
        setBot(botData);
        setFormData({
          name: botData.name || '',
          token: botData.token || '',
          telegram_username: botData.telegram_username || '',
          description: botData.description || '',
          status: botData.status || 'live',
          public_listing: botData.public_listing !== undefined ? botData.public_listing : true,
          main_buttons: (botData.main_buttons || []).join(', '),
          welcome_message: botData.messages?.welcome || '',
          thank_you_message: botData.messages?.thank_you || '',
          support_message: botData.messages?.support || '',
          promotions_message: botData.messages?.promotions || '',
          profile_picture_url: botData.profile_picture_url || '',
          inline_action_info: botData.inline_action_messages?.info || '',
          main_button_messages: (() => {
            const messages: Record<string, string> = {};
            const mainButtons = botData.main_buttons || [];
            
            // Map each button name to its saved message
            mainButtons.forEach((btn: string) => {
              const buttonName = btn.trim();
              // Strip emojis and special chars to get the database key (same logic as when saving)
              const dbKey = buttonName.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
              // Look up the message in the database using the dbKey
              const savedMessage = botData.messages?.[dbKey] || '';
              // Store it using the full button name (with emojis) as the key
              messages[buttonName] = savedMessage;
            });
            
            return messages;
          })(),
          // Convert emojis from database back to category values for form
          categories: getValuesFromEmojis(botData.categories || []),
          featured: botData.featured || false,
          cut_off_time: (() => {
            // Ensure time format is correct for HTML time input (HH:MM)
            const time = botData.cut_off_time || '';
            if (time && time.trim()) {
              // Ensure format is HH:MM (time input expects this format)
              const parts = time.split(':');
              if (parts.length >= 2) {
                const hours = parts[0].padStart(2, '0');
                const minutes = parts[1].padStart(2, '0');
                return `${hours}:${minutes}`;
              }
            }
            return '';
          })(),
          routes: botData.routes || '',
          language: botData.language || '',
          website_url: botData.website_url || '',
          instagram_url: botData.instagram_url || '',
          telegram_channel: botData.telegram_channel || '',
          telegram_group: botData.telegram_group || '',
          rating: botData.rating || '',
          rating_count: botData.rating_count || '',
          vendor_pgp_key: botData.vendor_pgp_key || '',
          payment_methods: (botData.payment_methods && Array.isArray(botData.payment_methods) && botData.payment_methods.length > 0)
            ? botData.payment_methods.filter((m: string) => m === 'BTC' || m === 'LTC') // Only allow BTC/LTC
            : ['BTC', 'LTC'], // Default to both
          payout_ltc_address: botData.payout_ltc_address || '',
          payout_btc_address: botData.payout_btc_address || '',
          shipping_methods: (() => {
            const methods = botData.shipping_methods;
            if (methods && Array.isArray(methods) && methods.length > 0) {
              const out: Record<string, number> = {};
              methods.forEach((m: { code: string; name: string; cost: number }) => {
                out[m.code] = typeof m.cost === 'number' ? m.cost : 0;
              });
              return { STD: 0, EXP: 5, NXT: 10, ...out };
            }
            return { STD: 0, EXP: 5, NXT: 10 };
          })(),
          menu_inline_buttons: (() => {
            // If menu_inline_buttons exist, use them; otherwise auto-generate from main_buttons
            if (botData.menu_inline_buttons && Array.isArray(botData.menu_inline_buttons) && botData.menu_inline_buttons.length > 0) {
              return JSON.stringify(botData.menu_inline_buttons, null, 2);
            }
            // Auto-generate from main_buttons (2 buttons per row)
            const mainButtons = botData.main_buttons || [];
            const autoButtons: any[][] = [];
            for (let i = 0; i < mainButtons.length; i += 2) {
              const row = [];
              const action1 = mainButtons[i].replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
              row.push({ text: mainButtons[i], action: action1 });
              if (i + 1 < mainButtons.length) {
                const action2 = mainButtons[i + 1].replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
                row.push({ text: mainButtons[i + 1], action: action2 });
              }
              autoButtons.push(row);
            }
            return autoButtons.length > 0 ? JSON.stringify(autoButtons, null, 2) : '';
          })(),
        });
      } else {
        setError('Failed to load bot');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfilePicture = async () => {
    if (!formData.profile_picture_url || !formData.token) {
      setError('Profile picture URL and bot token are required');
      return;
    }

    setUpdatingProfilePic(true);
    setError('');

    try {
      const response = await fetch(`/api/bots/${botId}/profile-picture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profile_picture_url: formData.profile_picture_url,
          token: formData.token,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.instructions) {
          const message = data.message + '\n\n' + data.instructions.join('\n');
          alert(message);
        } else {
          alert(data.message || 'Profile picture updated successfully!');
        }
      } else {
        const data = await response.json();
        if (data.instructions) {
          const message = data.message + '\n\n' + data.instructions.join('\n');
          alert(message);
        } else {
          setError(data.error || 'Failed to update profile picture');
        }
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setUpdatingProfilePic(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const main_buttons = formData.main_buttons
        .split(',')
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

      const updateData: any = {
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
          support: formData.support_message || '',
          promotions: formData.promotions_message || '',
          // Add messages for each main menu button
          ...Object.fromEntries(
            Object.entries(formData.main_button_messages).map(([btn, msg]) => {
              // Replace all spaces with underscores, not just the first one
              // Strip emojis and special chars, keep only alphanumeric and spaces
              const key = btn.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
              return [key, msg];
            })
          ),
        },
        inline_action_messages: {
          info: formData.inline_action_info || '',
        },
        profile_picture_url: formData.profile_picture_url,
        menu_inline_buttons: (() => {
          try {
            if (formData.menu_inline_buttons && formData.menu_inline_buttons.trim()) {
              return JSON.parse(formData.menu_inline_buttons);
            }
          } catch (e) {
            console.error('Error parsing menu_inline_buttons:', e);
          }
          return [];
        })(),
        cut_off_time: (() => {
          // Ensure time is saved in correct format (HH:MM)
          const time = formData.cut_off_time;
          console.log('Processing cut_off_time - raw value:', time, 'type:', typeof time);
          if (time && typeof time === 'string') {
            const trimmed = time.trim();
            if (trimmed) {
              // Ensure format is HH:MM
              const parts = trimmed.split(':');
              console.log('Time parts:', parts);
              if (parts.length >= 2 && parts[0] && parts[1]) {
                const hours = parts[0].padStart(2, '0');
                const minutes = parts[1].padStart(2, '0');
                const formatted = `${hours}:${minutes}`;
                console.log('Formatted cut_off_time:', formatted);
                return formatted;
              }
            }
          }
          console.log('cut_off_time will be empty string');
          return '';
        })(),
        routes: formData.routes || '',
        language: formData.language || '',
        website_url: formData.website_url || '',
        instagram_url: formData.instagram_url || '',
        telegram_channel: formData.telegram_channel || '',
        telegram_group: formData.telegram_group || '',
        rating: formData.rating || '',
        rating_count: formData.rating_count || '',
        vendor_pgp_key: formData.vendor_pgp_key || '',
        payment_methods: formData.payment_methods.filter(m => m === 'BTC' || m === 'LTC'), // Only save BTC/LTC
        payout_ltc_address: formData.payout_ltc_address || '',
        payout_btc_address: formData.payout_btc_address || '',
        shipping_methods: [
          { code: 'STD', name: 'Standard Delivery', cost: Number(formData.shipping_methods.STD) || 0 },
          { code: 'EXP', name: 'Express Delivery', cost: Number(formData.shipping_methods.EXP) || 0 },
          { code: 'NXT', name: 'Next Day Delivery', cost: Number(formData.shipping_methods.NXT) || 0 },
        ],
      };

      // Only include categories and featured if user is super-admin
      if (userRole === 'super-admin') {
        // Convert category values to emojis for storage
        const categoryEmojis = getEmojisFromValues(formData.categories || []);
        updateData.categories = categoryEmojis;
        updateData.featured = formData.featured || false;
      }

      // Debug: Log what we're sending
      console.log('Saving bot with data:', {
        categories: updateData.categories,
        featured: updateData.featured,
        cut_off_time: updateData.cut_off_time,
        cut_off_time_raw: formData.cut_off_time,
        userRole: userRole,
      });
      console.log('Full updateData:', JSON.stringify(updateData, null, 2));

      const response = await fetch(`/api/bots/${botId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (response.ok) {
        const savedBot = await response.json();
        console.log('Bot saved successfully:', {
          categories: savedBot.categories,
          featured: savedBot.featured,
          cut_off_time: savedBot.cut_off_time,
        });
        router.push('/admin/bots');
      } else {
        const data = await response.json();
        console.error('Error saving bot:', data);
        setError(data.error || 'Failed to update bot');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Bot</h1>

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
            <label className="block text-sm font-medium text-gray-700">Status</label>
            <select
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
            >
              <option value="live">Live</option>
              <option value="offline">Offline</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Main Menu Buttons</label>
            <input
              type="text"
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="Shop, Support, Promotions, Orders"
              value={formData.main_buttons}
              onChange={(e) => {
                const buttons = e.target.value;
                const buttonList = buttons.split(',').map(b => b.trim()).filter(b => b.length > 0);
                
                // Auto-generate menu_inline_buttons from main_buttons (2 buttons per row)
                const autoButtons: any[][] = [];
                for (let i = 0; i < buttonList.length; i += 2) {
                  const row = [];
                  const action1 = buttonList[i].replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
                  row.push({ text: buttonList[i], action: action1 });
                  if (i + 1 < buttonList.length) {
                    const action2 = buttonList[i + 1].replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
                    row.push({ text: buttonList[i + 1], action: action2 });
                  }
                  autoButtons.push(row);
                }
                
                setFormData({ 
                  ...formData, 
                  main_buttons: buttons,
                  menu_inline_buttons: autoButtons.length > 0 ? JSON.stringify(autoButtons, null, 2) : formData.menu_inline_buttons,
                  // Initialize messages for new buttons
                  main_button_messages: (() => {
                    const existing = formData.main_button_messages || {};
                    const newMessages: Record<string, string> = { ...existing };
                    buttonList.forEach((btnName: string) => {
                      if (btnName && !newMessages[btnName]) {
                        newMessages[btnName] = '';
                      }
                    });
                    return newMessages;
                  })()
                });
              }}
            />
            <p className="mt-1 text-sm text-gray-500">Comma-separated list (e.g., Shop, Support, Promotions, Orders)</p>
          </div>

          {formData.main_buttons && formData.main_buttons.split(',').filter((b: string) => b.trim()).length > 0 && (
            <div className="border-t pt-4 mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-3">Main Menu Button Messages</label>
              <p className="mb-3 text-sm text-gray-500">
                Customize the message/content shown when users click each main menu button. Leave empty to use default behavior.
              </p>
              <div className="space-y-4">
                {formData.main_buttons.split(',').filter((b: string) => b.trim()).map((button: string) => {
                  const buttonName = button.trim();
                  // Strip emojis and special chars, keep only alphanumeric and spaces
                  const buttonKey = buttonName.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
                  const isSpecial = ['shop', 'orders'].includes(buttonKey);
                  
                  return (
                    <div key={buttonName} className="border border-gray-200 rounded-md p-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {buttonName}
                        {isSpecial && (
                          <span className="ml-2 text-xs text-gray-500">(Special button - message shows before default action)</span>
                        )}
                      </label>
                      <textarea
                        className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                        rows={2}
                        placeholder={isSpecial 
                          ? `Custom message for ${buttonName} button (shows before ${buttonKey === 'shop' ? 'shop' : 'orders'} content)`
                          : `Message shown when users click "${buttonName}"`
                        }
                        value={formData.main_button_messages[buttonName] || ''}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            main_button_messages: {
                              ...formData.main_button_messages,
                              [buttonName]: e.target.value
                            }
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">Welcome Message</label>
            <textarea
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              rows={3}
              placeholder="Use {{secret_phrase}} to include user's secret phrase"
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

          <div>
            <label className="block text-sm font-medium text-gray-700">Inline Button - "Info" Action Message</label>
            <textarea
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              rows={4}
              placeholder={'Custom message for \'More Info\' button. Use {{product_name}}, {{product_description}}, {{product_price}}, {{product_currency}}, {{product_id}} as placeholders.'}
              value={formData.inline_action_info}
              onChange={(e) => setFormData({ ...formData, inline_action_info: e.target.value })}
            />
            <p className="mt-1 text-sm text-gray-500">
              Leave empty to use default format. Available variables:{' '}
              <code className="bg-gray-100 px-1 rounded">{'{{product_name}}'}</code>,{' '}
              <code className="bg-gray-100 px-1 rounded">{'{{product_description}}'}</code>,{' '}
              <code className="bg-gray-100 px-1 rounded">{'{{product_price}}'}</code>,{' '}
              <code className="bg-gray-100 px-1 rounded">{'{{product_currency}}'}</code>,{' '}
              <code className="bg-gray-100 px-1 rounded">{'{{product_id}}'}</code>
            </p>
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

          {userRole === 'super-admin' && (
            <>
              <div className="border-t pt-4 mt-4">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Super Admin Settings</h3>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Categories</label>
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md p-3">
                    {CATEGORIES.map((category) => (
                      <label key={category.value} className="flex items-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 text-indigo-600"
                          checked={formData.categories.includes(category.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                categories: [...formData.categories, category.value],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                categories: formData.categories.filter(c => c !== category.value),
                              });
                            }
                          }}
                        />
                        <span className="ml-2 text-sm text-gray-700">
                          {category.emoji} {category.label}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    Select categories for this bot. These will be displayed as emojis on the front page.
                  </p>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="featured"
                    className="h-4 w-4 text-indigo-600"
                    checked={formData.featured}
                    onChange={(e) => setFormData({ ...formData, featured: e.target.checked })}
                  />
                  <label htmlFor="featured" className="ml-2 text-sm text-gray-700">
                    Featured Store
                  </label>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Featured stores appear first on the front page and have special styling.
                </p>
              </div>
            </>
          )}

          <div className="border-t pt-4 mt-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Menu Inline Buttons</h3>
            <p className="text-sm text-gray-500 mb-2">
              Configure inline buttons that appear when users type /menu. Format: JSON array of button rows.
              <br />
              <span className="font-semibold text-indigo-600">Auto-generated from Main Menu Buttons above</span> - buttons are automatically created (2 per row) when you update Main Menu Buttons. You can customize the layout here.
            </p>
            <textarea
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
              rows={12}
              placeholder={`Example:\n[\n  [\n    {"text": "👋 Help", "action": "help"},\n    {"text": "🤝 User Guide", "action": "user_guide"}\n  ],\n  [\n    {"text": "🎁 Collections", "action": "collections"}\n  ],\n  [\n    {"text": "⏳ Pending(0)", "action": "pending"},\n    {"text": "📦 History(3)", "action": "history"}\n  ]\n]`}
              value={formData.menu_inline_buttons}
              onChange={(e) => setFormData({ ...formData, menu_inline_buttons: e.target.value })}
            />
            <p className="mt-1 text-xs text-gray-500">
              Each outer array is a row. Each button can have: "text" (required), "action" (callback_data), or "url" (for URL buttons).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Profile Picture</label>
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
              {formData.profile_picture_url && (
                <button
                  type="button"
                  onClick={handleUpdateProfilePicture}
                  disabled={updatingProfilePic || !formData.token}
                  className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updatingProfilePic ? 'Updating...' : 'Update on Telegram'}
                </button>
              )}
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
              Enter a URL or upload an image (max 2MB). Save to store in database. "Update on Telegram" syncs to the bot via BotFather.
            </p>
          </div>

          <div className="border-t pt-4 mt-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Welcome Message Settings</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Shipping Routes</label>
                <input
                  type="text"
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="United Kingdom 🇬🇧 ➤ Europe 🇪🇺"
                  value={formData.routes}
                  onChange={(e) => setFormData({ ...formData, routes: e.target.value })}
                />
                <p className="mt-1 text-sm text-gray-500">Shipping routes displayed in welcome message</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Delivery Method Costs</label>
                <p className="mt-1 text-sm text-gray-500 mb-2">Set the cost for each delivery method (in order currency, e.g. GBP)</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <label className="text-sm text-gray-600 w-40">Standard Delivery</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="block w-24 border border-gray-300 rounded-md px-3 py-2"
                      placeholder="0"
                      value={formData.shipping_methods.STD ?? 0}
                      onChange={(e) => setFormData({ ...formData, shipping_methods: { ...formData.shipping_methods, STD: parseFloat(e.target.value) || 0 } })}
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-sm text-gray-600 w-40">Express Delivery</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="block w-24 border border-gray-300 rounded-md px-3 py-2"
                      placeholder="5"
                      value={formData.shipping_methods.EXP ?? 5}
                      onChange={(e) => setFormData({ ...formData, shipping_methods: { ...formData.shipping_methods, EXP: parseFloat(e.target.value) || 0 } })}
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-sm text-gray-600 w-40">Next Day Delivery</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="block w-24 border border-gray-300 rounded-md px-3 py-2"
                      placeholder="10"
                      value={formData.shipping_methods.NXT ?? 10}
                      onChange={(e) => setFormData({ ...formData, shipping_methods: { ...formData.shipping_methods, NXT: parseFloat(e.target.value) || 0 } })}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Language</label>
                <input
                  type="text"
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="British English"
                  value={formData.language}
                  onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Rating (%)</label>
                <input
                  type="text"
                  className={`mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 ${userRole !== 'super-admin' ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                  placeholder="96.81"
                  value={formData.rating}
                  onChange={(e) => setFormData({ ...formData, rating: e.target.value })}
                  disabled={userRole !== 'super-admin'}
                  readOnly={userRole !== 'super-admin'}
                />
                {userRole !== 'super-admin' && (
                  <p className="mt-1 text-sm text-gray-500">Updates automatically from customer reviews.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Rating Count</label>
                <input
                  type="text"
                  className={`mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 ${userRole !== 'super-admin' ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                  placeholder="7707"
                  value={formData.rating_count}
                  onChange={(e) => setFormData({ ...formData, rating_count: e.target.value })}
                  disabled={userRole !== 'super-admin'}
                  readOnly={userRole !== 'super-admin'}
                />
                {userRole !== 'super-admin' && (
                  <p className="mt-1 text-sm text-gray-500">Updates automatically from customer reviews.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Cut-Off Time</label>
                <input
                  type="time"
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="14:30"
                  value={formData.cut_off_time}
                  onChange={(e) => setFormData({ ...formData, cut_off_time: e.target.value })}
                />
                <p className="mt-1 text-sm text-gray-500">
                  Order cut-off time in 24-hour format (e.g., 14:30 for 2:30 PM). This will be displayed on the front page.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Official Website URL</label>
                <input
                  type="url"
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="https://example.com"
                  value={formData.website_url}
                  onChange={(e) => setFormData({ ...formData, website_url: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Instagram URL</label>
                <input
                  type="text"
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="instagram.com/yourprofile"
                  value={formData.instagram_url}
                  onChange={(e) => setFormData({ ...formData, instagram_url: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Telegram Channel</label>
                <input
                  type="text"
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="YourChannel (without @)"
                  value={formData.telegram_channel}
                  onChange={(e) => setFormData({ ...formData, telegram_channel: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Telegram Group</label>
                <input
                  type="text"
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="YourGroup (without @)"
                  value={formData.telegram_group}
                  onChange={(e) => setFormData({ ...formData, telegram_group: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Vendor PGP Key</label>
                <textarea
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                  rows={8}
                  placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----&#10;...&#10;-----END PGP PUBLIC KEY BLOCK-----"
                  value={formData.vendor_pgp_key}
                  onChange={(e) => setFormData({ ...formData, vendor_pgp_key: e.target.value })}
                />
                <p className="mt-1 text-sm text-gray-500">
                  Vendor's public PGP key. This will be displayed in the contact interface for users to verify messages.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Methods (Front Page Display)</label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={formData.payment_methods.includes('BTC')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            payment_methods: [...formData.payment_methods.filter(m => m !== 'BTC'), 'BTC'],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            payment_methods: formData.payment_methods.filter(m => m !== 'BTC'),
                          });
                        }
                      }}
                    />
                    <span className="ml-2 text-sm text-gray-700">BTC (Bitcoin)</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={formData.payment_methods.includes('LTC')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            payment_methods: [...formData.payment_methods.filter(m => m !== 'LTC'), 'LTC'],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            payment_methods: formData.payment_methods.filter(m => m !== 'LTC'),
                          });
                        }
                      }}
                    />
                    <span className="ml-2 text-sm text-gray-700">LTC (Litecoin)</span>
                  </label>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Select which payment methods to display on the front page. Only BTC and LTC are supported.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payout Wallet Addresses</label>
                <p className="text-sm text-gray-500 mb-3">
                  Set your wallet addresses for automatic payouts. When a customer pays, 90% is automatically sent to your wallet.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">LTC Payout Address</label>
                    <input
                      type="text"
                      value={formData.payout_ltc_address}
                      onChange={(e) => setFormData({ ...formData, payout_ltc_address: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
                      placeholder="ltc1q... or L... or M..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">BTC Payout Address</label>
                    <input
                      type="text"
                      value={formData.payout_btc_address}
                      onChange={(e) => setFormData({ ...formData, payout_btc_address: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
                      placeholder="bc1q... or 1... or 3..."
                    />
                  </div>
                </div>
              </div>
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

