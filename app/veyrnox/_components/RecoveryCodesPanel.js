'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { getStoredUserId, verifyFactor } from '../../lib/authClient.js';
import { generateRecoveryCodes, recoveryStatus } from '../../lib/mfaRecoveryClient.js';

const CONTROL = 'min-h-11 rounded-xl px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-60';

export default function RecoveryCodesPanel({ aal, factors, codes, onCodes, onSaved }) {
    const { t } = useI18n();
    const [loaded, setLoaded] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [code, setCode] = useState('');
    const [copied, setCopied] = useState(false);
    const [retry, setRetry] = useState(0);
    const lifetime = useRef({ id: 0 });
    useEffect(() => {
        const life = lifetime.current;
        return () => { ++life.id; };
    }, []);
    const inFlight = useRef(false);
    const inputRef = useRef(null);
    const factorKey = factors.map(f => f.id).join(',');
    const status = loaded?.factorKey === factorKey && loaded?.aal === aal && loaded?.retry === retry && loaded?.codes === codes ? loaded.value : null;

    useEffect(() => {
        let active = true;
        if (aal === 'aal2') {
            recoveryStatus().then(value => {
                if (active) { setLoaded({ value, factorKey, aal, codes, retry }); setError(null); }
            }).catch(err => {
                if (active) setError(tOr(t, `app.account.mfa.recovery.error.${err?.code}`, t('app.account.mfa.recovery.failed')));
            });
        }
        return () => { active = false; };
    }, [aal, factorKey, codes, retry, t]);
    useEffect(() => { if (confirming) inputRef.current?.focus(); }, [confirming]);

    async function regenerate(event) {
        event.preventDefault();
        if (inFlight.current || !/^[0-9]{6}$/.test(code)) return;
        inFlight.current = true; setBusy(true); setError(null);
        const user = getStoredUserId();
        const gen = lifetime.current.id;
        try {
            // Always perform a fresh challenge; the server independently checks mfa-at.
            if (await verifyFactor(factors[0].id, code) !== 'aal2') throw { code: 'reauth_required' };
            if (user !== getStoredUserId()) return;
            const result = await generateRecoveryCodes();
            if (user !== getStoredUserId() || gen !== lifetime.current.id) return;
            onCodes(result.codes); setConfirming(false); setCode(''); setCopied(false);
        } catch (err) {
            if (user === getStoredUserId() && gen === lifetime.current.id) setError(tOr(t, `app.account.mfa.recovery.error.${err?.code}`, t('app.account.mfa.recovery.failed')));
        } finally { inFlight.current = false; setBusy(false); }
    }

    async function copy() {
        try { await navigator.clipboard.writeText(codes.join('\n')); setCopied(true); }
        catch { setError(t('app.account.mfa.recovery.error.copy_failed')); }
    }
    function download() {
        const url = URL.createObjectURL(new Blob([codes.join('\n') + '\n'], { type: 'text/plain' }));
        const link = document.createElement('a');
        link.href = url; link.download = 'veyrnox-recovery-codes.txt'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return (
        <section aria-label={t('app.account.mfa.recovery.title')} className="mt-4 space-y-3 border-t border-vx-border pt-4">
            <h3 className="text-base font-semibold text-vx-fg">{t('app.account.mfa.recovery.title')}</h3>
            {error && <p role="alert" className="text-sm text-vx-danger">
                {error}
                <button type="button" className={`${CONTROL} underline`} onClick={() => setRetry(n => n + 1)}>{t('app.account.mfa.retry')}</button>
            </p>}
            {codes ? <>
                <p role="status" className="text-sm text-vx-fg-body">{t('app.account.mfa.recovery.saveHelp')}</p>
                <pre dir="ltr" className="select-all whitespace-pre-wrap rounded-xl bg-vx-panel p-4 text-sm text-vx-fg">{codes.join('\n')}</pre>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className={`${CONTROL} text-vx-accent underline`} onClick={copy}>{t('app.account.mfa.recovery.copy')}</button>
                    <button type="button" className={`${CONTROL} text-vx-accent underline`} onClick={download}>{t('app.account.mfa.recovery.download')}</button>
                    <span role="status" className="text-sm text-vx-fg-body">{copied ? t('app.account.mfa.recovery.copied') : null}</span>
                </div>
                <button type="button" className={`${CONTROL} min-h-13 bg-vx-accent text-vx-accent-ink`} onClick={onSaved}>{t('app.account.mfa.recovery.saved')}</button>
            </> : <>
                <p role="status" className="text-sm text-vx-fg-body">
                    {aal !== 'aal2' ? t('app.account.mfa.recovery.verifyHelp') : status
                        ? status.needs_regeneration ? t('app.account.mfa.recovery.needed') : t('app.account.mfa.recovery.remaining', { count: status.usable })
                        : t('app.account.mfa.recovery.loading')}
                </p>
                {confirming ? <form onSubmit={regenerate} className="space-y-3">
                    <p className="text-sm text-vx-fg-body">{t('app.account.mfa.recovery.verifyHelp')}</p>
                    <input ref={inputRef} value={code} onChange={e => setCode(e.target.value.trim())} disabled={busy}
                        aria-label={t('app.account.mfa.code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr"
                        className={`${CONTROL} w-full border border-vx-border bg-vx-panel text-vx-fg`} />
                    <button type="submit" disabled={busy || !/^[0-9]{6}$/.test(code)} className={`${CONTROL} min-h-13 bg-vx-accent text-vx-accent-ink`}>
                        {busy ? t('authGate.working') : t('app.account.mfa.recovery.generate')}
                    </button>
                </form> : <button type="button" onClick={() => setConfirming(true)}
                    className={`${CONTROL} min-h-13 bg-vx-accent text-vx-accent-ink`}>
                    {t(status?.needs_regeneration || !status?.usable ? 'app.account.mfa.recovery.generate' : 'app.account.mfa.recovery.regenerate')}
                </button>}
            </>}
            <span role="status" className="sr-only">{busy ? t('authGate.working') : null}</span>
        </section>
    );
}
