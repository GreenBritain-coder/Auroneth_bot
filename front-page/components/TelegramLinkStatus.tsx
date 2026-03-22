'use client';

import { useState, useCallback } from 'react';
import TelegramLoginButton, {
  type TelegramAuthData,
} from './TelegramLoginButton';

interface TelegramLinkStatusProps {
  botUsername: string;
  botId: string;
  initialLinkedUsername: string | null;
}

export default function TelegramLinkStatus({
  botUsername,
  botId,
  initialLinkedUsername,
}: TelegramLinkStatusProps) {
  const [linkedUsername, setLinkedUsername] = useState(initialLinkedUsername);
  const [showWidget, setShowWidget] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = useCallback(
    async (data: TelegramAuthData) => {
      setLinking(true);
      setError(null);

      try {
        const res = await fetch('/api/shop/telegram-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, botId }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Link failed');
        }

        const result = await res.json();
        setLinkedUsername(result.display_name);
        setShowWidget(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Link failed');
      } finally {
        setLinking(false);
      }
    },
    [botId]
  );

  if (linkedUsername) {
    return (
      <span className="text-sm text-gray-400 flex items-center gap-1.5">
        <svg
          className="w-4 h-4 text-blue-400"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
        Linked as {linkedUsername}
      </span>
    );
  }

  return (
    <div className="relative">
      {!showWidget ? (
        <button
          onClick={() => setShowWidget(true)}
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1.5"
        >
          <svg
            className="w-4 h-4"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
          </svg>
          Link Telegram
        </button>
      ) : (
        <div className="absolute right-0 top-full mt-2 bg-gray-700 rounded-lg p-3 shadow-xl border border-gray-600 z-50 min-w-[250px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">
              Sign in with Telegram
            </span>
            <button
              onClick={() => {
                setShowWidget(false);
                setError(null);
              }}
              className="text-gray-400 hover:text-white text-xs"
            >
              Cancel
            </button>
          </div>
          {linking ? (
            <div className="text-sm text-gray-300 py-2">Linking...</div>
          ) : (
            <TelegramLoginButton
              botUsername={botUsername}
              onAuth={handleAuth}
            />
          )}
          {error && (
            <p className="text-xs text-red-400 mt-2">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
