'use client';

import { useEffect, useState } from 'react';
import { phoneAvailable, readAuthSettings } from '../app/lib/authProviders.js';
import { sendPhoneOtp, verifyPhoneOtp } from '../app/lib/phoneAuth.js';
import { useI18n } from './I18nProvider.jsx';
import {
    CAPTCHA_BLOCKED_CODE,
    CAPTCHA_UNSUPPORTED,
    CAPTCHA_WAITING,
    captchaNotice,
    noticeAfterCaptchaFailure,
    noticeAfterCaptchaToken,
    noticeWhileCaptchaWaits,
} from '../app/lib/turnstileFailure.js';
import { TURNSTILE_SITE_KEY, Turnstile } from './Turnstile.jsx';

const E164_RE = /^\+[1-9]\d{7,14}$/;

function phoneError(t, error) {
    const raw = String(error?.message || '');
    if (/phone provider is disabled|sms provider|unsupported phone provider/i.test(raw)) return t('phoneAuth.unavailable');
    if (/rate limit/i.test(raw)) return t('phoneAuth.rateLimited');
    if (/token.*expired|otp.*expired/i.test(raw)) return t('phoneAuth.expired');
    if (/invalid.*(token|otp)|token.*invalid/i.test(raw)) return t('phoneAuth.invalid');
    if (/captcha/i.test(raw)) return t('phoneAuth.captcha');
    if (/network|fetch|failed to fetch/i.test(raw)) return t('phoneAuth.network');
    return t('phoneAuth.failed');
}

export default function PhoneOtpForm() {
    const { t } = useI18n();
    const [step, setStep] = useState('request');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const [settings, setSettings] = useState(null);
    const [captcha, setCaptcha] = useState(null);
    const [captchaFailure, setCaptchaFailure] = useState(null);
    const [captchaReset, setCaptchaReset] = useState(0);

    useEffect(() => {
        let cancelled = false;
        readAuthSettings(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
            .then((value) => { if (!cancelled) setSettings(value); });
        return () => { cancelled = true; };
    }, []);

    async function requestCode(event) {
        event.preventDefault();
        setNotice(null);
        const normalized = phone.replace(/[\s()-]/g, '');
        if (!E164_RE.test(normalized)) {
            setNotice({ kind: 'error', text: t('phoneAuth.numberHelp') });
            return;
        }
        if (!phoneAvailable(settings)) {
            setNotice({ kind: 'error', text: t('phoneAuth.unavailable') });
            return;
        }
        if (TURNSTILE_SITE_KEY && !captcha) {
            setNotice(captchaNotice(captchaFailure, t));
            return;
        }
        setBusy(true);
        try {
            await sendPhoneOtp(normalized, captcha);
            setPhone(normalized);
            setStep('verify');
            setNotice({ kind: 'success', text: t('phoneAuth.sent', { phone: normalized }) });
        } catch (error) {
            setNotice({ kind: 'error', text: phoneError(t, error) });
        } finally {
            setBusy(false);
            if (TURNSTILE_SITE_KEY) setCaptchaReset((value) => value + 1);
        }
    }

    async function verifyCode(event) {
        event.preventDefault();
        setNotice(null);
        if (!/^\d{6}$/.test(code)) {
            setNotice({ kind: 'error', text: t('phoneAuth.codeHelp') });
            return;
        }
        setBusy(true);
        try {
            await verifyPhoneOtp(phone, code);
        } catch (error) {
            setNotice({ kind: 'error', text: phoneError(t, error) });
            setBusy(false);
        }
    }

    return (
        <form onSubmit={step === 'request' ? requestCode : verifyCode} className="space-y-3">
            <label className="block">
                <span className="text-xs text-vx-fg-muted">{t('phoneAuth.mobileNumber')}</span>
                <input type="tel" inputMode="tel" autoComplete="tel" required disabled={step === 'verify' || busy}
                    value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+44 7700 900123"
                    className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm text-vx-fg outline-hidden focus:border-vx-accent focus-visible:ring-2 focus-visible:ring-vx-accent/40 disabled:opacity-70" />
            </label>

            {step === 'request' ? (
                <Turnstile
                    onToken={(token) => { setCaptcha(token); if (token) { setCaptchaFailure(null); setNotice(noticeAfterCaptchaToken); } }}
                    onFailure={(value) => { setCaptchaFailure(value); setNotice((current) => noticeAfterCaptchaFailure(current, value, t)); }}
                    onError={() => { setCaptchaFailure(CAPTCHA_BLOCKED_CODE); setNotice(captchaNotice(CAPTCHA_BLOCKED_CODE, t)); }}
                    onWaiting={() => { setCaptchaFailure(CAPTCHA_WAITING); setNotice((current) => noticeWhileCaptchaWaits(current, t)); }}
                    onUnsupported={() => { setCaptchaFailure(CAPTCHA_UNSUPPORTED); setNotice((current) => noticeAfterCaptchaFailure(current, CAPTCHA_UNSUPPORTED, t)); }}
                    resetKey={captchaReset}
                />
            ) : (
                <label className="block">
                    <span className="text-xs text-vx-fg-muted">{t('phoneAuth.sixDigitCode')}</span>
                    <input type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6}
                        value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-center text-lg tracking-[0.4em] text-vx-fg outline-hidden focus:border-vx-accent focus-visible:ring-2 focus-visible:ring-vx-accent/40" />
                </label>
            )}

            <div role="status" aria-live="polite" className={notice ? 'block' : 'sr-only'}>
                {notice && <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${notice.kind === 'error' ? 'border-vx-danger/30 bg-vx-danger/10 text-vx-danger' : 'border-vx-accent/30 bg-vx-accent/10 text-vx-accent'}`}>
                    <span aria-hidden="true">{notice.kind === 'error' ? '✕' : '✓'}</span><span>{notice.text}</span>
                </div>}
            </div>

            <button type="submit" disabled={busy} className="w-full rounded-full bg-vx-accent py-2.5 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-60">
                {t(busy ? 'phoneAuth.working' : step === 'request' ? 'phoneAuth.send' : 'phoneAuth.verify')}
            </button>
            {step === 'verify' && <button type="button" disabled={busy} onClick={() => { setStep('request'); setCode(''); setNotice(null); }} className="w-full text-xs text-vx-fg-muted underline hover:text-vx-fg disabled:opacity-60">{t('phoneAuth.change')}</button>}
        </form>
    );
}
