'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { inboxTotal } from '@/lib/chat';

// One live view of the signed-in person's chats (the Inbox), shared by the sidebar badge, the phone top bar,
// the Inbox page and the job and lead tabs. New messages arrive over Supabase Realtime; the list also refreshes
// every minute and when the app comes back to the foreground, so the badge is right even if the live
// connection drops (phones do that). Pages tell it to refresh with window.dispatchEvent(new Event('chat-changed')).

const Ctx = createContext({ rows: [], unread: 0, loaded: false, missing: false, refresh: () => {} });

// A missing function means migration 017 has not been run yet.
const notInstalled = (err) => !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function|does not exist|schema cache/i.test(err.message || ''));

export function ChatInboxProvider({ userId, children }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const missingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId || missingRef.current) return;
    const { data, error } = await getSupabase().rpc('chat_inbox');
    if (error) {
      if (notInstalled(error)) { missingRef.current = true; setMissing(true); }
      setLoaded(true);
      return;
    }
    setRows(data || []);
    setLoaded(true);
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!userId) return undefined;
    const sb = getSupabase();
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };
    let channel = null;
    try {
      channel = sb.channel(`chat-inbox-${userId}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, soon)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_acks' }, soon)
        .subscribe();
    } catch { /* live updates are a bonus; polling below still works */ }
    const poll = setInterval(refresh, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    window.addEventListener('chat-changed', soon);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('chat-changed', soon);
      if (channel) sb.removeChannel(channel);
    };
  }, [userId, refresh]);

  const value = useMemo(() => ({ rows, unread: inboxTotal(rows), loaded, missing, refresh }), [rows, loaded, missing, refresh]);
  return createElement(Ctx.Provider, { value }, children);
}

export const useChatCenter = () => useContext(Ctx);
