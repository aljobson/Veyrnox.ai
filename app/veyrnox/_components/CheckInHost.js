'use client';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { gatewayFetch } from '../_lib/gateway';
import { checkinStatusReader } from '../_lib/checkinStatus';
import { CheckInDialog } from './CheckInDialog';

const utcDay = () => new Date().toISOString().slice(0, 10);
const dismissed = new Map();
const keyFor = (user) => `veyrnox.checkin.${user}`;
const announce = (user, status) => window.dispatchEvent(new CustomEvent('veyrnox:checkin-status', { detail: { user, status } }));
function wasDismissed(user) {
  try { return dismissed.get(user) === utcDay() || localStorage.getItem(keyFor(user)) === utcDay(); }
  catch { return dismissed.get(user) === utcDay(); }
}
function remember(user) {
  dismissed.set(user, utcDay());
  try { localStorage.setItem(keyFor(user), utcDay()); } catch { /* display preference only */ }
}

export function CheckInHost() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    const sync = () => setUser(getStoredUserId());
    sync(); return onSessionChange(sync);
  }, []);
  return user ? <CheckInForUser key={user} user={user} /> : null;
}

function CheckInForUser({ user }) {
  const reader = useMemo(() => checkinStatusReader(user, () => gatewayFetch('/checkin')), [user]);
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    async function load(manual = false) {
      const next = await reader.read();
      if (!live || getStoredUserId() !== user) return;
      setStatus(next); announce(user, next);
      setOpen(!!next && (manual || (!next.claimed_today && !wasDismissed(user))));
    }
    void load();
    const reopen = () => void load(true);
    const poll = () => { if (reader.due()) void load(); };
    // Entries subscribe and request a snapshot regardless of mount order. No second GET.
    const snapshot = () => announce(user, reader.peek());
    window.addEventListener('veyrnox:checkin-open', reopen);
    window.addEventListener('veyrnox:checkin-status-request', snapshot);
    window.addEventListener('focus', poll);
    const timer = setInterval(poll, 60_000);
    return () => {
      live = false; clearInterval(timer);
      window.removeEventListener('veyrnox:checkin-open', reopen);
      window.removeEventListener('veyrnox:checkin-status-request', snapshot);
      window.removeEventListener('focus', poll);
    };
  }, [user, reader]);
  if (!status || !open) return null;
  return <CheckInDialog key={user} status={status}
    onClose={() => { remember(user); setOpen(false); }}
    onDisabled={() => { reader.stop(); setStatus(null); setOpen(false); announce(user, null); }}
    onClaim={(r) => {
      if (getStoredUserId() !== user) return;
      remember(user);
      const next = { ...status, claimed_today: true, streak: r.streak };
      reader.update(next); setStatus(next); announce(user, next);
    }} />;
}

export function CheckInEntry() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const receive = (event) => {
      if (event.detail?.user === getStoredUserId()) setEnabled(!!event.detail.status);
    };
    const sync = () => {
      setEnabled(false);
      window.dispatchEvent(new Event('veyrnox:checkin-status-request'));
    };
    window.addEventListener('veyrnox:checkin-status', receive);
    const unsubscribe = onSessionChange(sync);
    sync();
    return () => { unsubscribe(); window.removeEventListener('veyrnox:checkin-status', receive); };
  }, []);
  return enabled ? <button type="button" className="mt-4 min-h-11 rounded-full border border-vx-border px-5 text-sm font-bold"
    onClick={() => window.dispatchEvent(new Event('veyrnox:checkin-open'))}>{t('checkin.entry')}</button> : null;
}
