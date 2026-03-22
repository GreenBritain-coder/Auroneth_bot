'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Bot {
  _id: string;
  name: string;
}

interface ConversationSummary {
  botId: string;
  userId: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface ConversationListResponse {
  conversations: ConversationSummary[];
  page: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
}

interface ChatEntry {
  _id: string;
  type: 'user' | 'vendor';
  message: string;
  timestamp: string;
  read?: boolean;
  repliedBy?: string;
}

interface ChatMessagesResponse {
  messages: ChatEntry[];
  page: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CONV_PAGE_SIZE = 20;
const MSG_PAGE_SIZE = 50;
const POLL_INTERVAL = 15_000; // 15 seconds

// ─── Component ──────────────────────────────────────────────────────────────

export default function ContactsPage() {
  // Bots & filters
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Conversation list (sidebar)
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [convPage, setConvPage] = useState(1);
  const [convHasMore, setConvHasMore] = useState(false);
  const [convTotalCount, setConvTotalCount] = useState(0);
  const [convLoading, setConvLoading] = useState(true);
  const [convLoadingMore, setConvLoadingMore] = useState(false);

  // Active conversation chat
  const [activeKey, setActiveKey] = useState<string | null>(null); // "botId::userId"
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [chatPage, setChatPage] = useState(1);
  const [chatHasMore, setChatHasMore] = useState(false);
  const [chatTotalCount, setChatTotalCount] = useState(0);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatLoadingOlder, setChatLoadingOlder] = useState(false);

  // Reply
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // General
  const [error, setError] = useState('');

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived helpers
  const activeBotId = activeKey ? activeKey.split('::')[0] : '';
  const activeUserId = activeKey ? activeKey.split('::')[1] : '';

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  // ── Fetch bots (once) ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/bots');
        if (res.ok) setBots(await res.json());
      } catch (err) {
        console.error('Error fetching bots:', err);
      }
    })();
  }, []);

  // ── Fetch conversation list ───────────────────────────────────────────

  const fetchConversations = useCallback(
    async (page: number, append: boolean = false) => {
      if (page === 1) setConvLoading(true);
      else setConvLoadingMore(true);

      try {
        const params = new URLSearchParams({
          view: 'conversations',
          page: String(page),
          limit: String(CONV_PAGE_SIZE),
        });
        if (selectedBotId) params.set('botId', selectedBotId);
        if (unreadOnly) params.set('unreadOnly', 'true');

        const res = await fetch(`/api/contacts?${params.toString()}`);
        if (!res.ok) {
          setError('Failed to fetch conversations');
          return;
        }

        const data: ConversationListResponse = await res.json();

        setConversations((prev) =>
          append ? [...prev, ...data.conversations] : data.conversations,
        );
        setConvPage(data.page);
        setConvHasMore(data.hasMore);
        setConvTotalCount(data.totalCount);
      } catch {
        setError('Network error loading conversations');
      } finally {
        setConvLoading(false);
        setConvLoadingMore(false);
      }
    },
    [selectedBotId, unreadOnly],
  );

  // Reload conversation list when filters change
  useEffect(() => {
    fetchConversations(1);
  }, [fetchConversations]);

  // ── Fetch chat messages for the active conversation ───────────────────

  const fetchChatMessages = useCallback(
    async (botId: string, userId: string, page: number, prepend: boolean = false) => {
      if (page === 1) setChatLoading(true);
      else setChatLoadingOlder(true);

      try {
        const params = new URLSearchParams({
          botId,
          userId,
          page: String(page),
          limit: String(MSG_PAGE_SIZE),
        });

        const res = await fetch(`/api/contacts?${params.toString()}`);
        if (!res.ok) {
          setError('Failed to fetch messages');
          return;
        }

        const data: ChatMessagesResponse = await res.json();

        setChatEntries((prev) => (prepend ? [...data.messages, ...prev] : data.messages));
        setChatPage(data.page);
        setChatHasMore(data.hasMore);
        setChatTotalCount(data.totalCount);
      } catch {
        setError('Network error loading messages');
      } finally {
        setChatLoading(false);
        setChatLoadingOlder(false);
      }
    },
    [],
  );

  // ── Polling ───────────────────────────────────────────────────────────

  useEffect(() => {
    // Clear old timer
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(() => {
      // Refresh conversation list (for badge updates)
      fetchConversations(1);

      // If viewing a conversation, refresh its messages too
      if (activeKey) {
        const [bId, uId] = activeKey.split('::');
        fetchChatMessages(bId, uId, 1);
      }
    }, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchConversations, fetchChatMessages, activeKey]);

  // ── Select conversation ───────────────────────────────────────────────

  const handleSelectConversation = async (conv: ConversationSummary) => {
    const key = `${conv.botId}::${conv.userId}`;
    setActiveKey(key);
    setReplyText('');
    setError('');
    setChatEntries([]);
    setChatPage(1);
    setChatHasMore(false);

    // Fetch first page of messages
    await fetchChatMessages(conv.botId, conv.userId, 1);

    // Bulk mark as read
    if (conv.unreadCount > 0) {
      try {
        await fetch('/api/contacts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botId: conv.botId, userId: conv.userId, read: true }),
        });
        // Update local conversation list
        setConversations((prev) =>
          prev.map((c) =>
            c.botId === conv.botId && c.userId === conv.userId
              ? { ...c, unreadCount: 0 }
              : c,
          ),
        );
        // Update chat entries read state
        setChatEntries((prev) => prev.map((e) => (e.type === 'user' ? { ...e, read: true } : e)));
      } catch (err) {
        console.error('Error marking as read:', err);
      }
    }
  };

  // Auto-scroll to bottom when chat loads or new messages arrive (page 1 only)
  useEffect(() => {
    if (chatPage === 1 && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatEntries, chatPage]);

  // ── Load older messages ───────────────────────────────────────────────

  const loadOlderMessages = async () => {
    if (!activeKey || !chatHasMore || chatLoadingOlder) return;
    const scrollEl = chatContainerRef.current;
    const prevScrollHeight = scrollEl?.scrollHeight || 0;

    await fetchChatMessages(activeBotId, activeUserId, chatPage + 1, true);

    // Preserve scroll position after prepending
    requestAnimationFrame(() => {
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight - prevScrollHeight;
      }
    });
  };

  // ── Send reply ────────────────────────────────────────────────────────

  const sendReply = async () => {
    if (!replyText.trim() || !activeKey) return;

    setSendingReply(true);
    setError('');

    try {
      const res = await fetch('/api/contacts/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUserId,
          botId: activeBotId,
          message: replyText.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Append the new response to chat
        if (data.response) {
          const newEntry: ChatEntry = {
            _id: data.response._id,
            type: 'vendor',
            message: data.response.message,
            timestamp: data.response.timestamp,
            repliedBy: data.response.repliedBy,
          };
          setChatEntries((prev) => [...prev, newEntry]);
        }
        // Mark all messages as read in chat
        setChatEntries((prev) =>
          prev.map((e) => (e.type === 'user' ? { ...e, read: true } : e)),
        );
        // Update sidebar
        setConversations((prev) =>
          prev.map((c) =>
            c.botId === activeBotId && c.userId === activeUserId
              ? { ...c, unreadCount: 0, lastMessage: 'You: ' + replyText.trim(), lastMessageAt: new Date().toISOString() }
              : c,
          ),
        );
        setReplyText('');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to send reply');
      }
    } catch {
      setError('Network error while sending reply');
    } finally {
      setSendingReply(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────

  const getBotName = (botId: string) => {
    const bot = bots.find((b) => b._id === botId);
    return bot ? bot.name : botId;
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  const formatTime = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateString;
    }
  };

  const formatDateHeader = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (date.toDateString() === today.toDateString()) return 'Today';
      if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
      return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-8rem)]">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Contact Messages</h1>
        <Link
          href="/admin/bots"
          className="text-indigo-600 hover:text-indigo-800"
        >
          &larr; Back to Bots
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
          <button
            onClick={() => setError('')}
            className="ml-2 text-red-500 hover:text-red-700 font-bold"
          >
            x
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter by Bot
            </label>
            <select
              className="block w-full border border-gray-300 rounded-md px-3 py-2"
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
            >
              <option value="">All Bots</option>
              {bots.map((bot) => (
                <option key={bot._id} value={bot._id}>
                  {bot.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
              />
              <span className="ml-2 text-sm text-gray-700">
                Unread only ({totalUnread})
              </span>
            </label>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => {
                fetchConversations(1);
                if (activeKey) {
                  fetchChatMessages(activeBotId, activeUserId, 1);
                }
              }}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main content: conversation list + chat view */}
      {convLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : conversations.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          No contact messages found.
        </div>
      ) : (
        <div className="flex bg-white shadow rounded-lg overflow-hidden" style={{ height: 'calc(100% - 10rem)' }}>
          {/* Conversation list sidebar */}
          <div className="w-80 flex-shrink-0 border-r border-gray-200 overflow-y-auto">
            {conversations.map((conv) => {
              const key = `${conv.botId}::${conv.userId}`;
              const isActive = activeKey === key;
              return (
                <div
                  key={key}
                  onClick={() => handleSelectConversation(conv)}
                  className={`px-4 py-3 cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${
                    isActive ? 'bg-indigo-50 border-l-4 border-l-indigo-600' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      User: {conv.userId}
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold bg-indigo-600 text-white">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {getBotName(conv.botId)}
                  </div>
                  {conv.lastMessage && (
                    <div className="text-xs text-gray-400 mt-1 truncate">
                      {conv.lastMessage}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-0.5">
                    {formatDate(conv.lastMessageAt)}
                  </div>
                </div>
              );
            })}

            {/* Load more conversations */}
            {convHasMore && (
              <div className="p-3 text-center">
                <button
                  onClick={() => fetchConversations(convPage + 1, true)}
                  disabled={convLoadingMore}
                  className="text-sm text-indigo-600 hover:text-indigo-800 disabled:text-gray-400"
                >
                  {convLoadingMore ? 'Loading...' : `Load more (${conversations.length} of ${convTotalCount})`}
                </button>
              </div>
            )}
          </div>

          {/* Chat view */}
          <div className="flex-1 flex flex-col">
            {activeKey ? (
              <>
                {/* Chat header */}
                <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">
                        User: {activeUserId}
                      </h3>
                      <p className="text-xs text-gray-500">
                        Bot: {getBotName(activeBotId)}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">
                      {chatTotalCount} message{chatTotalCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* Chat messages */}
                <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
                  {/* Load older messages button */}
                  {chatHasMore && (
                    <div className="text-center mb-3">
                      <button
                        onClick={loadOlderMessages}
                        disabled={chatLoadingOlder}
                        className="text-xs text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1 rounded-full disabled:text-gray-400"
                      >
                        {chatLoadingOlder ? 'Loading...' : 'Load older messages'}
                      </button>
                    </div>
                  )}

                  {chatLoading ? (
                    <div className="text-center py-8 text-gray-400">Loading messages...</div>
                  ) : (
                    chatEntries.map((entry, idx) => {
                      const prevEntry = idx > 0 ? chatEntries[idx - 1] : null;
                      const showDateHeader =
                        !prevEntry ||
                        new Date(entry.timestamp).toDateString() !==
                          new Date(prevEntry.timestamp).toDateString();

                      return (
                        <div key={entry._id}>
                          {showDateHeader && (
                            <div className="flex justify-center my-3">
                              <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                                {formatDateHeader(entry.timestamp)}
                              </span>
                            </div>
                          )}
                          {entry.type === 'user' ? (
                            /* User message - left aligned */
                            <div className="flex justify-start mb-2">
                              <div className="max-w-[70%]">
                                <div className="bg-gray-100 rounded-lg rounded-tl-none px-4 py-2">
                                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                                    {entry.message}
                                  </p>
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5 ml-1">
                                  {formatTime(entry.timestamp)}
                                  {entry.read === false && (
                                    <span className="ml-1 text-indigo-500 font-medium">new</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* Vendor reply - right aligned */
                            <div className="flex justify-end mb-2">
                              <div className="max-w-[70%]">
                                <div className="bg-indigo-600 text-white rounded-lg rounded-tr-none px-4 py-2">
                                  <p className="text-sm whitespace-pre-wrap break-words">
                                    {entry.message}
                                  </p>
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5 text-right mr-1">
                                  {entry.repliedBy && (
                                    <span className="mr-1">{entry.repliedBy}</span>
                                  )}
                                  {formatTime(entry.timestamp)}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Reply input */}
                <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
                  <div className="flex gap-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (replyText.trim() && !sendingReply) {
                            sendReply();
                          }
                        }
                      }}
                      placeholder="Type your reply... (Enter to send, Shift+Enter for new line)"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      rows={2}
                    />
                    <button
                      onClick={sendReply}
                      disabled={sendingReply || !replyText.trim()}
                      className="self-end bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      {sendingReply ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* No conversation selected */
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                  <p className="mt-2 text-sm">Select a conversation to view messages</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
