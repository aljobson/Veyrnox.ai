'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { currentSessionId, listDevices, endDevice } from '../../lib/accountSecurity';
import { ConfirmDialog } from './ConfirmDialog';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';

export function deviceName(device, t) {
  if (device?.kind === 'app_ios') return t('app.account.devices.appIos');
  if (device?.kind === 'app_android') return t('app.account.devices.appAndroid');
  const parts = [device?.browser, device?.system].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('app.account.devices.unknown');
}

/** Per-device list for the Signed-in devices card (ADR-0363). The two bulk buttons stay in the page. */
export function DevicesPanel({ refreshKey }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('loading');
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState('');
  const [current, setCurrent] = useState('');

  const load = useCallback(async () => {
    setState('loading'); setMessage('');
    try { setCurrent(currentSessionId()); setRows(await listDevices()); setState('ready'); }
    catch { setState('error'); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);

  async function end() {
    const device = selected;
    setSelected(null);
    if (!device) return;
    setState('ending'); setMessage('');
    try { await endDevice(device.id); setRows(r => r.filter(x => x.id !== device.id)); setMessage(t('app.account.devices.ended')); setState('ready'); }
    catch { setMessage(t('app.account.devices.endFailed')); setState('ready'); }
  }

  const when = value => value ? new Date(value).toLocaleString(localeTag(locale)) : '';
  return <div data-testid="devices-list" className="mb-4">
    {state === 'loading' && <p role="status" className="text-sm text-vx-fg-muted">{t('app.account.devices.loading')}</p>}
    {state === 'error' && <p role="alert" className="text-sm text-vx-danger">{t('app.account.devices.loadFailed')} <button type="button" className="underline" onClick={load}>{t('app.publish.developer.refresh')}</button></p>}
    {state !== 'loading' && state !== 'error' && rows.length === 0 && <p data-testid="devices-empty" className="text-sm text-vx-fg-body">{t('app.account.devices.empty')}</p>}
    {rows.length > 0 && <ul className="divide-y divide-vx-border border-y border-vx-border">
      {rows.map(row => {
        const mine = row.id === current;
        return <li key={row.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-extrabold text-vx-fg">{deviceName(row.device, t)}{mine && <span className="ml-2 rounded-full bg-vx-panel px-2 py-0.5 text-xs font-bold">{t('app.account.devices.thisDevice')}</span>}</p>
            {row.last_used && <p className="mt-1 text-xs text-vx-fg-muted">{t('app.account.devices.lastUsed', { date: when(row.last_used) })}</p>}
          </div>
          {!mine && <button type="button" disabled={state === 'ending'} className={button} data-testid="device-sign-out" onClick={() => setSelected(row)}>{t('public.account.signOut')}</button>}
        </li>;
      })}
    </ul>}
    {message && <p role="status" className="mt-2 text-sm text-vx-accent">{message}</p>}
    {selected && <ConfirmDialog title={t('app.account.devices.confirm', { name: deviceName(selected.device, t) })} body={t('app.account.devices.confirmBody')} confirmLabel={t('public.account.signOut')} onCancel={() => setSelected(null)} onConfirm={end} />}
  </div>;
}
