'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface TelegramAuthData {
  id: number;
  first_name: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface TelegramLoginButtonProps {
  botUsername: string;
  onAuth: (data: TelegramAuthData) => void;
}

declare global {
  interface Window {
    __telegramLoginCallback?: (data: TelegramAuthData) => void;
  }
}

export default function TelegramLoginButton({
  botUsername,
  onAuth,
}: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleAuth = useCallback(
    (data: TelegramAuthData) => {
      onAuth(data);
    },
    [onAuth]
  );

  useEffect(() => {
    // Set global callback for the Telegram widget
    window.__telegramLoginCallback = handleAuth;

    const container = containerRef.current;
    if (!container) return;

    // Clear any previous widget
    container.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'medium');
    script.setAttribute('data-onauth', '__telegramLoginCallback(user)');
    script.setAttribute('data-request-access', 'write');

    container.appendChild(script);

    return () => {
      delete window.__telegramLoginCallback;
    };
  }, [botUsername, handleAuth]);

  return <div ref={containerRef} />;
}
