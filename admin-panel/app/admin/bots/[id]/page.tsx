'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
    payment_methods: ['BTC', 'LTC'] as string[], // Supported payment methods
    payout_ltc_address: '', // Vendor's LTC payout address
    payout_btc_address: '', // Vendor's BTC payout address
    payout_usdt_address: '', // Vendor's USDT (TRC20) payout address
    shipping_methods: { STD: 0, EXP: 5, NXT: 10 } as Record<string, number>, // Delivery method costs (Standard, Express, Next Day)
    custom_buttons: [] as Array<{
      label: string;
      message: string;
      type: 'text' | 'url' | 'system';
      action?: string;
      undeletable?: boolean;
      url?: string;
      order: number;
      enabled: boolean;
    }>,
    web_shop_enabled: false,
    web_shop_slug: '',
    web_shop_description: '',
  });
  const [updatingProfilePic, setUpdatingProfilePic] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Drag and drop state (editor list)
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  // Drag and drop state (preview)
  const [previewDragIdx, setPreviewDragIdx] = useState<number | null>(null);
  const [previewDropIdx, setPreviewDropIdx] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDragIndex(index);
    dragNodeRef.current = e.currentTarget as HTMLDivElement;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    // Make the drag image slightly transparent
    requestAnimationFrame(() => {
      if (dragNodeRef.current) {
        dragNodeRef.current.style.opacity = '0.4';
      }
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.opacity = '1';
    }
    setDragIndex(null);
    setDropTargetIndex(null);
    dragNodeRef.current = null;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndex !== null && dragIndex !== index) {
      setDropTargetIndex(index);
    }
  }, [dragIndex]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDropTargetIndex(null);
      return;
    }
    const sorted = [...formData.custom_buttons].sort((a, b) => a.order - b.order);
    const [moved] = sorted.splice(dragIndex, 1);
    sorted.splice(dropIndex, 0, moved);
    // Reassign order values
    const reordered = sorted.map((btn, i) => ({ ...btn, order: i }));
    setFormData(prev => ({ ...prev, custom_buttons: reordered }));
    setDragIndex(null);
    setDropTargetIndex(null);
  }, [dragIndex, formData.custom_buttons]);

  // Preview drag handlers — operate on the flat list of non-fixed custom buttons
  const FIXED_SYSTEM_ACTIONS = new Set(['shop', 'orders', 'view_wishlist', 'view_cart', 'contact', 'pgp', 'about', 'view_all_reviews']);

  const handlePreviewDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, flatIndex: number) => {
    setPreviewDragIdx(flatIndex);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(flatIndex));
    requestAnimationFrame(() => {
      (e.target as HTMLDivElement).style.opacity = '0.4';
    });
  }, []);

  const handlePreviewDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    (e.target as HTMLDivElement).style.opacity = '1';
    setPreviewDragIdx(null);
    setPreviewDropIdx(null);
  }, []);

  const handlePreviewDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, flatIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (previewDragIdx !== null && previewDragIdx !== flatIndex) {
      setPreviewDropIdx(flatIndex);
    }
  }, [previewDragIdx]);

  const handlePreviewDrop = useCallback((e: React.DragEvent<HTMLDivElement>, dropFlatIndex: number) => {
    e.preventDefault();
    if (previewDragIdx === null || previewDragIdx === dropFlatIndex) {
      setPreviewDragIdx(null);
      setPreviewDropIdx(null);
      return;
    }
    // Get the non-fixed custom buttons in order
    const allSorted = [...formData.custom_buttons].sort((a, b) => a.order - b.order);
    const customOnly = allSorted.filter(b => !FIXED_SYSTEM_ACTIONS.has(b.action || ''));
    const fixedOnly = allSorted.filter(b => FIXED_SYSTEM_ACTIONS.has(b.action || ''));

    const [moved] = customOnly.splice(previewDragIdx, 1);
    customOnly.splice(dropFlatIndex, 0, moved);

    // Rebuild with reassigned order values
    const reordered = [...customOnly, ...fixedOnly].map((btn, i) => ({ ...btn, order: i }));
    setFormData(prev => ({ ...prev, custom_buttons: reordered }));
    setPreviewDragIdx(null);
    setPreviewDropIdx(null);
  }, [previewDragIdx, formData.custom_buttons]);

  useEffect(() => {
    // Get user role from server
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => setUserRole(data.role || 'bot-owner'))
      .catch(() => {});
    
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
            ? botData.payment_methods
            : ['BTC', 'LTC'], // Default to both
          payout_ltc_address: botData.payout_ltc_address || '',
          payout_btc_address: botData.payout_btc_address || '',
          payout_usdt_address: botData.payout_usdt_address || '',
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
          custom_buttons: (() => {
            // Check if custom_buttons already has system buttons
            const existing = botData.custom_buttons && Array.isArray(botData.custom_buttons) ? botData.custom_buttons : [];
            const hasSystemButtons = existing.some((b: any) => b.type === 'system');

            if (hasSystemButtons) {
              return existing.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
            }

            // Migration: seed system buttons + keep existing custom buttons
            const mainButtons = botData.main_buttons || [];
            const mainButtonMessages = botData.messages || {};
            const hasPromo = mainButtons.some((b: string) => b && b.replace(/[^\w\s]/g, '').toLowerCase().trim() === 'promotions');
            const hasDiscounts = mainButtons.some((b: string) => b && b.replace(/[^\w\s]/g, '').toLowerCase().trim() === 'discounts');
            const hasPgp = !!(botData.vendor_pgp_key);

            const systemButtons: any[] = [];
            let order = 0;
            systemButtons.push({ label: '\u2B50 Reviews', type: 'system', action: 'view_all_reviews', undeletable: false, enabled: true, order: order++, message: '' });
            if (hasPromo) {
              systemButtons.push({ label: '\uD83D\uDC8E Promotions', type: 'system', action: 'promotions', undeletable: false, enabled: true, order: order++, message: mainButtonMessages['promotions'] || '' });
            }
            if (hasDiscounts) {
              systemButtons.push({ label: '\u2B50 Discounts', type: 'system', action: 'discounts', undeletable: false, enabled: true, order: order++, message: mainButtonMessages['discounts'] || '' });
            }
            systemButtons.push({ label: '\uD83D\uDECD\uFE0F Shop', type: 'system', action: 'shop', undeletable: true, enabled: true, order: order++, message: '' });
            systemButtons.push({ label: '\uD83D\uDCE6 Orders', type: 'system', action: 'orders', undeletable: true, enabled: true, order: order++, message: '' });
            systemButtons.push({ label: '\u2764\uFE0F Wishlist', type: 'system', action: 'view_wishlist', undeletable: false, enabled: true, order: order++, message: '' });
            systemButtons.push({ label: '\uD83D\uDED2 Cart', type: 'system', action: 'view_cart', undeletable: false, enabled: true, order: order++, message: '' });
            systemButtons.push({ label: '\uD83D\uDCAC Contact', type: 'system', action: 'contact', undeletable: true, enabled: true, order: order++, message: '' });
            if (hasPgp) {
              systemButtons.push({ label: '\uD83D\uDD10 PGP', type: 'system', action: 'pgp', undeletable: false, enabled: true, order: order++, message: '' });
            }
            systemButtons.push({ label: '\u2139\uFE0F About', type: 'system', action: 'about', undeletable: false, enabled: true, order: order++, message: '' });

            // Add existing custom (non-system) buttons after system ones
            const customOnly = existing.filter((b: any) => b.type !== 'system');
            // Also migrate from main_buttons if no custom_buttons existed
            let migratedCustom: any[] = [];
            if (customOnly.length === 0 && mainButtons.length > 0) {
              const systemActions = new Set(systemButtons.map((s: any) => s.action));
              const systemLabelKeys = new Set(systemButtons.map((s: any) => s.label.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_')));
              migratedCustom = mainButtons
                .filter((btn: string) => btn && btn.trim())
                .map((btn: string) => {
                  const dbKey = btn.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
                  return { label: btn.trim(), message: mainButtonMessages[dbKey] || '', type: 'text' as const, url: '', order: 0, enabled: true };
                })
                .filter((btn: any) => {
                  const key = btn.label.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
                  return !systemActions.has(key) && !systemLabelKeys.has(key);
                });
            } else {
              migratedCustom = customOnly;
            }

            const allButtons = [...systemButtons];
            migratedCustom.forEach((btn: any) => {
              allButtons.push({ ...btn, order: order++ });
            });

            return allButtons;
          })(),
          web_shop_enabled: botData.web_shop_enabled || false,
          web_shop_slug: botData.web_shop_slug || '',
          web_shop_description: botData.web_shop_description || '',
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
      // Generate main_buttons and menu_inline_buttons from custom_buttons for backward compatibility
      const enabledButtons = formData.custom_buttons
        .filter(btn => btn.enabled)
        .sort((a, b) => a.order - b.order);

      // main_buttons only includes non-system buttons for backward compat
      const main_buttons = enabledButtons.filter(btn => btn.type !== 'system').map(btn => btn.label);

      // Auto-generate menu_inline_buttons from custom_buttons (2 per row)
      const autoMenuInlineButtons: any[][] = [];
      for (let i = 0; i < enabledButtons.length; i += 2) {
        const row = [];
        const btn1 = enabledButtons[i];
        const action1 = btn1.label.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
        if (btn1.type === 'url' && btn1.url) {
          row.push({ text: btn1.label, action: action1, url: btn1.url });
        } else {
          row.push({ text: btn1.label, action: action1 });
        }
        if (i + 1 < enabledButtons.length) {
          const btn2 = enabledButtons[i + 1];
          const action2 = btn2.label.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
          if (btn2.type === 'url' && btn2.url) {
            row.push({ text: btn2.label, action: action2, url: btn2.url });
          } else {
            row.push({ text: btn2.label, action: action2 });
          }
        }
        autoMenuInlineButtons.push(row);
      }

      // Build button messages from custom_buttons
      const buttonMessages: Record<string, string> = {};
      formData.custom_buttons.forEach(btn => {
        const key = btn.label.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
        if (btn.message) {
          buttonMessages[key] = btn.message;
        }
      });

      const updateData: any = {
        name: formData.name,
        token: formData.token,
        telegram_username: formData.telegram_username.trim().replace('@', ''),
        description: formData.description,
        status: formData.status,
        public_listing: formData.public_listing,
        main_buttons,
        custom_buttons: formData.custom_buttons,
        messages: {
          welcome: formData.welcome_message || 'Welcome!',
          thank_you: formData.thank_you_message || 'Thank you for your purchase!',
          support: formData.support_message || '',
          promotions: formData.promotions_message || '',
          // Add messages for each custom button
          ...buttonMessages,
        },
        inline_action_messages: {
          info: formData.inline_action_info || '',
        },
        profile_picture_url: formData.profile_picture_url,
        menu_inline_buttons: autoMenuInlineButtons,
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
        payment_methods: formData.payment_methods,
        payout_ltc_address: formData.payout_ltc_address || '',
        payout_btc_address: formData.payout_btc_address || '',
        payout_usdt_address: formData.payout_usdt_address || '',
        shipping_methods: [
          { code: 'STD', name: 'Standard Delivery', cost: Number(formData.shipping_methods.STD) || 0 },
          { code: 'EXP', name: 'Express Delivery', cost: Number(formData.shipping_methods.EXP) || 0 },
          { code: 'NXT', name: 'Next Day Delivery', cost: Number(formData.shipping_methods.NXT) || 0 },
        ],
        web_shop_enabled: formData.web_shop_enabled,
        web_shop_slug: formData.web_shop_slug || formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        web_shop_description: formData.web_shop_description || '',
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

          <div className="border-t pt-4 mt-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Custom Menu Buttons</h3>
                <p className="text-sm text-gray-500">Add custom buttons between Reviews and Shop. System buttons (Shop, Orders, Wishlist, Cart, Contact, About) have a fixed layout across all bots. Drag to reorder custom buttons.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const newButton = {
                    label: '',
                    message: '',
                    type: 'text' as const,
                    url: '',
                    order: formData.custom_buttons.length,
                    enabled: true,
                  };
                  setFormData({
                    ...formData,
                    custom_buttons: [...formData.custom_buttons, newButton],
                  });
                }}
                className="bg-indigo-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-indigo-700"
              >
                + Add Button
              </button>
            </div>

            <div className="flex flex-col lg:flex-row gap-6">
              {/* Button Builder */}
              <div className="flex-1 min-w-0">
                {formData.custom_buttons.filter(b => !(['shop', 'orders', 'view_wishlist', 'view_cart', 'contact', 'pgp', 'about', 'view_all_reviews'].includes((b as any).action || ''))).length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                    <p className="text-gray-500">No custom buttons configured. Click &quot;Add Button&quot; to create one.</p>
                  </div>
                )}

                <div className="space-y-1">
                  {formData.custom_buttons
                    .filter(b => !(['shop', 'orders', 'view_wishlist', 'view_cart', 'contact', 'pgp', 'about', 'view_all_reviews'].includes((b as any).action || '')))
                    .sort((a, b) => a.order - b.order)
                    .map((btn, index) => {
                      const isSystem = btn.type === 'system';
                      const isUndeletable = !!(btn as any).undeletable;
                      const buttonKey = btn.label.replace(/[^\w\s]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
                      const isSpecial = ['shop', 'orders'].includes(buttonKey);
                      // Real index in the full (unfiltered) sorted array
                      const realIndex = [...formData.custom_buttons].sort((a, b) => a.order - b.order).findIndex(b => b.order === btn.order);

                      return (
                        <div key={btn.order}>
                          {/* Drop indicator line - shown above this item when it's the drop target */}
                          {dropTargetIndex === index && dragIndex !== null && dragIndex > index && (
                            <div className="h-1 bg-indigo-500 rounded-full mx-2 my-1 transition-all" />
                          )}
                          <div
                            draggable
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDrop={(e) => handleDrop(e, index)}
                            className={`border rounded-lg p-4 transition-all ${btn.enabled ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'} ${dragIndex === index ? 'ring-2 ring-indigo-300' : ''}`}
                          >
                            <div className="flex items-start gap-3">
                              {/* Drag handle */}
                              <div className="flex flex-col items-center gap-1 pt-1 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
                                </svg>
                                <span className="text-xs text-gray-400 font-mono">{index + 1}</span>
                                {isSystem && (
                                  <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold mt-0.5">System</span>
                                )}
                              </div>

                              {/* Button fields */}
                              <div className="flex-1 space-y-2">
                                <div className="flex gap-3">
                                  <div className="flex-1">
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Button Label</label>
                                    <input
                                      type="text"
                                      className="block w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                                      placeholder="e.g., Help, Promotions, User Guide"
                                      value={btn.label}
                                      onChange={(e) => {
                                        const buttons = [...formData.custom_buttons];
                                        const sorted = buttons.sort((a, b) => a.order - b.order);
                                        sorted[realIndex] = { ...sorted[realIndex], label: e.target.value };
                                        setFormData({ ...formData, custom_buttons: sorted });
                                      }}
                                    />
                                  </div>
                                  {!isSystem && (
                                    <div className="w-28">
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                                      <select
                                        className="block w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                                        value={btn.type}
                                        onChange={(e) => {
                                          const buttons = [...formData.custom_buttons];
                                          const sorted = buttons.sort((a, b) => a.order - b.order);
                                          sorted[realIndex] = { ...sorted[realIndex], type: e.target.value as 'text' | 'url' };
                                          setFormData({ ...formData, custom_buttons: sorted });
                                        }}
                                      >
                                        <option value="text">Text</option>
                                        <option value="url">URL</option>
                                      </select>
                                    </div>
                                  )}
                                  {isSystem && (
                                    <div className="w-28 flex items-end pb-0.5">
                                      <span className="text-xs text-gray-400 italic">Action: {(btn as any).action}</span>
                                    </div>
                                  )}
                                </div>

                                {btn.type === 'url' && (
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
                                    <input
                                      type="url"
                                      className="block w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                                      placeholder="https://example.com"
                                      value={btn.url || ''}
                                      onChange={(e) => {
                                        const buttons = [...formData.custom_buttons];
                                        const sorted = buttons.sort((a, b) => a.order - b.order);
                                        sorted[realIndex] = { ...sorted[realIndex], url: e.target.value };
                                        setFormData({ ...formData, custom_buttons: sorted });
                                      }}
                                    />
                                  </div>
                                )}

                                {!isSystem && (
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                      Message {btn.type === 'url' ? '(shown alongside link)' : '(shown when clicked)'}
                                      {isSpecial && (
                                        <span className="ml-1 text-gray-400">(Special button - message shows before default action)</span>
                                      )}
                                    </label>
                                    <textarea
                                      className="block w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                                      rows={2}
                                      placeholder={`Message displayed when "${btn.label || 'this button'}" is clicked`}
                                      value={btn.message}
                                      onChange={(e) => {
                                        const buttons = [...formData.custom_buttons];
                                        const sorted = buttons.sort((a, b) => a.order - b.order);
                                        sorted[realIndex] = { ...sorted[realIndex], message: e.target.value };
                                        setFormData({ ...formData, custom_buttons: sorted });
                                      }}
                                    />
                                  </div>
                                )}
                              </div>

                              {/* Enable toggle + delete */}
                              <div className="flex flex-col items-center gap-2 pt-1">
                                {isUndeletable ? (
                                  <>
                                    <div className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full bg-indigo-600 opacity-60 cursor-not-allowed border-2 border-transparent" title="Always enabled (locked)">
                                      <span className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 translate-x-4" />
                                    </div>
                                    <span className="text-xs text-gray-400">Locked</span>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const buttons = [...formData.custom_buttons].sort((a, b) => a.order - b.order);
                                        buttons[realIndex] = { ...buttons[realIndex], enabled: !buttons[realIndex].enabled };
                                        setFormData({ ...formData, custom_buttons: buttons });
                                      }}
                                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${btn.enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
                                      title={btn.enabled ? 'Enabled - click to disable' : 'Disabled - click to enable'}
                                    >
                                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${btn.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                    <span className="text-xs text-gray-500">{btn.enabled ? 'On' : 'Off'}</span>
                                  </>
                                )}
                                {isUndeletable ? (
                                  <div className="text-gray-300 mt-1" title="Cannot be deleted">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const buttons = [...formData.custom_buttons]
                                        .sort((a, b) => a.order - b.order)
                                        .filter((_, i) => i !== realIndex)
                                        .map((b, i) => ({ ...b, order: i }));
                                      setFormData({ ...formData, custom_buttons: buttons });
                                    }}
                                    className="text-red-400 hover:text-red-600 mt-1"
                                    title="Delete button"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* Drop indicator line - shown below this item when it's the drop target */}
                          {dropTargetIndex === index && dragIndex !== null && dragIndex < index && (
                            <div className="h-1 bg-indigo-500 rounded-full mx-2 my-1 transition-all" />
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Live Telegram Preview */}
              <div className="lg:w-80 flex-shrink-0">
                <div className="sticky top-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Live Preview</p>
                  <div className="rounded-xl overflow-hidden shadow-lg border border-gray-200" style={{ maxWidth: '320px' }}>
                    {/* Telegram header */}
                    <div className="bg-[#517da2] px-4 py-3 flex items-center gap-3">
                      {formData.profile_picture_url ? (
                        <img
                          src={formData.profile_picture_url}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-[#7ea8c9] flex items-center justify-center text-white text-sm font-bold">
                          {(formData.name || 'B').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="text-white text-sm font-medium leading-tight">{formData.name || 'Bot Name'}</div>
                        <div className="text-[#a8c8de] text-xs">bot</div>
                      </div>
                    </div>

                    {/* Chat area */}
                    <div className="bg-[#e5ddd5] px-3 py-4 min-h-[200px]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'p\' width=\'40\' height=\'40\' patternUnits=\'userSpaceOnUse\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'1\' fill=\'%23d4ccc4\' opacity=\'0.4\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect fill=\'url(%23p)\' width=\'200\' height=\'200\'/%3E%3C/svg%3E")' }}>
                      {/* Message bubble */}
                      <div className="max-w-[85%]">
                        <div className="bg-white rounded-lg rounded-tl-none px-3 py-2 shadow-sm">
                          <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-snug">
                            {formData.welcome_message || 'Welcome! How can I help you today?'}
                          </p>
                          <div className="text-right mt-1">
                            <span className="text-[10px] text-gray-400">12:00</span>
                          </div>
                        </div>

                        {/* Inline keyboard preview - fixed system layout + custom buttons */}
                        <div className="mt-1 space-y-1">
                          {(() => {
                            const btnStyle = "flex-1 text-center py-1.5 px-2 rounded text-[12px] font-medium truncate";
                            const btnColor = { backgroundColor: '#4a90d9', color: '#ffffff' };
                            const B = ({ label }: { label: string }) => (
                              <div className={btnStyle} style={btnColor}>{label}</div>
                            );

                            const fixedActions = new Set(['shop', 'orders', 'view_wishlist', 'view_cart', 'contact', 'pgp', 'about', 'view_all_reviews']);

                            // Custom buttons = enabled + NOT in fixed system set (includes Promotions, Discounts, etc.)
                            const customBtns = formData.custom_buttons
                              .filter(b => b.enabled && !fixedActions.has(b.action || ''))
                              .sort((a, b) => a.order - b.order);
                            const customRows: Array<typeof customBtns> = [];
                            for (let i = 0; i < customBtns.length; i += 3) {
                              customRows.push(customBtns.slice(i, i + 3));
                            }

                            const hasPgp = !!(formData as any).vendor_pgp_key;
                            let flatIdx = 0;

                            return (
                              <>
                                {/* Fixed: Reviews */}
                                <div className="flex gap-1"><B label="⭐ Reviews" /></div>
                                {/* Custom buttons (vendor-defined, draggable) */}
                                {customRows.map((row, ri) => (
                                  <div key={`c${ri}`} className="flex gap-1">
                                    {row.map((b) => {
                                      const idx = flatIdx++;
                                      return (
                                        <div
                                          key={idx}
                                          draggable
                                          onDragStart={(e) => handlePreviewDragStart(e, idx)}
                                          onDragEnd={handlePreviewDragEnd}
                                          onDragOver={(e) => handlePreviewDragOver(e, idx)}
                                          onDrop={(e) => handlePreviewDrop(e, idx)}
                                          className={btnStyle}
                                          style={{
                                            ...btnColor,
                                            cursor: 'grab',
                                            border: previewDropIdx === idx ? '2px solid #fff' : '2px solid transparent',
                                          }}
                                        >
                                          {b.label || 'Button'}
                                          {b.type === 'url' && <span className="ml-1" style={{ fontSize: '9px' }}>&#8599;</span>}
                                        </div>
                                      );
                                    })}
                                    {row.length === 1 && <><div className="flex-1" /><div className="flex-1" /></>}
                                    {row.length === 2 && <div className="flex-1" />}
                                  </div>
                                ))}
                                {/* Fixed: Shop + Orders */}
                                <div className="flex gap-1"><B label="🛍️ Shop" /><B label="📦 Orders (0)" /></div>
                                {/* Fixed: Wishlist + Cart */}
                                <div className="flex gap-1"><B label="❤️ Wishlist" /><B label="🛒 Cart (£0.00)" /></div>
                                {/* Fixed: Contact + PGP? + About */}
                                <div className="flex gap-1">
                                  <B label="💬 Contact" />
                                  {hasPgp && <B label="🔐 PGP" />}
                                  <B label="ℹ️ About" />
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Input bar */}
                    <div className="bg-[#f0f0f0] px-3 py-2 flex items-center gap-2 border-t border-gray-200">
                      <div className="flex-1 bg-white rounded-full px-3 py-1.5 text-xs text-gray-400 border border-gray-200">
                        Message
                      </div>
                      <div className="h-8 w-8 rounded-full bg-[#4a90d9] flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

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

          {/* Menu inline buttons are now auto-generated from custom_buttons above */}

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
                <label className="block text-sm font-medium text-gray-700">
                  Rating (%)
                  {userRole !== 'super-admin' && <span className="ml-2 text-xs text-blue-600 font-normal">Dynamic</span>}
                </label>
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
                  <p className="mt-1 text-sm text-gray-500">Calculated automatically from customer reviews. Cannot be edited.</p>
                )}
                {userRole === 'super-admin' && (
                  <p className="mt-1 text-sm text-gray-500">Override value. Leave empty to use dynamic calculation from reviews.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Rating Count
                  {userRole !== 'super-admin' && <span className="ml-2 text-xs text-blue-600 font-normal">Dynamic</span>}
                </label>
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
                  <p className="mt-1 text-sm text-gray-500">Total number of customer reviews. Cannot be edited.</p>
                )}
                {userRole === 'super-admin' && (
                  <p className="mt-1 text-sm text-gray-500">Override value. Leave empty to use dynamic calculation from reviews.</p>
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
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={formData.payment_methods.includes('USDT')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            payment_methods: [...formData.payment_methods.filter(m => m !== 'USDT'), 'USDT'],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            payment_methods: formData.payment_methods.filter(m => m !== 'USDT'),
                          });
                        }
                      }}
                    />
                    <span className="ml-2 text-sm text-gray-700">USDT (Tether TRC20)</span>
                  </label>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Select which payment methods to display. Customers will see these options at checkout.
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
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">USDT (TRC20) Payout Address</label>
                    <input
                      type="text"
                      value={formData.payout_usdt_address}
                      onChange={(e) => setFormData({ ...formData, payout_usdt_address: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
                      placeholder="T... (TRON TRC20 address)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Web Shop Settings */}
        <div className="border-t pt-4 mt-4">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Web Shop Settings</h3>
          <div className="space-y-4">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="web_shop_enabled"
                checked={formData.web_shop_enabled}
                onChange={(e) => setFormData({ ...formData, web_shop_enabled: e.target.checked })}
                className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
              />
              <label htmlFor="web_shop_enabled" className="ml-2 block text-sm font-medium text-gray-700">
                Enable Web Shop
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Web Shop Slug</label>
              <input
                type="text"
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder={formData.name ? formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'my-shop'}
                value={formData.web_shop_slug}
                onChange={(e) => setFormData({ ...formData, web_shop_slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              />
              <p className="mt-1 text-sm text-gray-500">
                URL-safe identifier for the web shop. Auto-generated from bot name if left empty.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Web Shop Description</label>
              <input
                type="text"
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Description shown on the web shop"
                value={formData.web_shop_description}
                onChange={(e) => setFormData({ ...formData, web_shop_description: e.target.value })}
              />
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

