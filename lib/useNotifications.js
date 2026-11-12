'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';
import { urlPath } from '@/lib/notificationTypes';

// One live connection to the signed-in person's notifications, shared by the sidebar badge, the
// top bar and the Notifications page. A new row arrives over Supabase Realtime; the list also
// refreshes every minute and when the app comes back to the foreground, so the badge is right
// even if the live connection drops (phones do that).

const Ctx = createContext(null);
const PAGE = 30;

export function NotificationsProvider({ userId, children }) {
  const pathname = usePathname() || '';
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const limitRef = useRef(PAGE);
  limitRef.current = limit;

  const load = useCallback(async () => {
    if (!userId) return;
    const sb = getSupabase();
    const [list, count] = await Promise.all([
      sb.from('notifications').select('*').eq('user_id', userId).order('at', { ascending: false }).limit(limitRef.current + 1),
      sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null).is('resolved_at', null),
    ]);
    if (!list.error) {
      const rows = list.data || [];
      setHasMore(rows.length > limitRef.current);
      setItems(rows.slice(0, limitRef.current));
    }
    if (!count.error) setUnread(count.count || 0);
    setLoaded(true);
  }, [userId]);

  useEffect(() => { load(); }, [load, limit]);

  useEffect(() => {
    if (!userId) return undefined;
    const sb = getSupabase();
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    let channel = null;
    try {
      channel = sb.channel(`notifications-${userId}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, soon)
        .subscribe();
    } catch { /* live updates are a bonus; polling below still works */ }
    const poll = setInterval(load, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
      if (channel) sb.removeChannel(channel);
    };
  }, [userId, load]);

  const markRead = useCallback(async (ids) => {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!list.length) return;
    const now = new Date().toISOString();
    setItems((cur) => cur.map((n) => (list.includes(n.id) && !n.read_at ? { ...n, read_at: now } : n)));
    setUnread((u) => Math.max(0, u - items.filter((n) => list.includes(n.id) && !n.read_at && !n.resolved_at).length));
    await getSupabase().from('notifications').update({ read_at: now }).in('id', list).is('read_at', null);
  }, [items]);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((cur) => cur.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnread(0);
    await getSupabase().from('notifications').update({ read_at: now }).eq('user_id', userId).is('read_at', null);
  }, [userId]);

  // Opening the page a notification points to counts as reading it.
  useEffect(() => {
    if (!pathname || pathname === '/notifications') return;
    const here = items.filter((n) => !n.read_at && urlPath(n.url) === pathname).map((n) => n.id);
    if (here.length) markRead(here);
  }, [pathname, items, markRead]);

  const value = useMemo(() => ({
    items, unread, loaded, hasMore, reload: load, markRead, markAllRead,
    loadMore: () => setLimit((l) => l + PAGE),
  }), [items, unread, loaded, hasMore, load, markRead, markAllRead]);

  return createElement(Ctx.Provider, { value }, children);
}

const EMPTY = { items: [], unread: 0, loaded: false, hasMore: false, reload() {}, markRead() {}, markAllRead() {}, loadMore() {} };

export function useNotificationCenter() {
  return useContext(Ctx) || EMPTY;
}
