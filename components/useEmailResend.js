"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { resendMagicLink, resendSignupEmail } from '../app/lib/authClient.js';
import { captchaNotice } from '../app/lib/turnstileFailure.js';

export function isEmailRateLimit(error) {
    return error?.status === 429 || [error?.code, error?.errorCode].some(code =>
        code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit');
}

export function useEmailResend({ busy, runningRef, setBusy, captcha, captchaRequired, captchaFailure, resetCaptcha,
    setNotice, humanAuthError, t, editAddress, focusNotice, redirectTo }) {
    const [pending, setPending] = useState(null);
    const [count, setCount] = useState(0);
    const [deadline, setDeadline] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const attempt = useRef(null);
    const cooldown = () => { setDeadline(Date.now() + 60000); setSeconds(60); };
    const reset = useCallback(() => {
        attempt.current = null;
        setPending(null); setCount(0); setDeadline(0); setSeconds(0);
    }, []);
    useEffect(() => {
        if (!deadline) return;
        const update = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [deadline]);
    function begin(flow, email) {
        const next = { flow, email, count: 0 };
        attempt.current = next; setPending(next); setCount(0); cooldown();
    }
    function changeAddress() {
        if (busy || runningRef.current) return;
        const flow = attempt.current?.flow;
        reset(); resetCaptcha(); setNotice(null);
        if (flow) editAddress(flow);
    }
    async function resend() {
        const current = attempt.current;
        if (!current || busy || runningRef.current || Date.now() < deadline || current.count >= 5) return;
        // Same rule as submit: without a configured widget there is no token to wait for.
        if (captchaRequired && !captcha) { setNotice(captchaNotice(captchaFailure, t)); return; }
        runningRef.current = true; setBusy(true);
        current.count += 1; setCount(current.count);
        try {
            if (current.flow === 'magic') await resendMagicLink(current.email, captcha, redirectTo());
            else await resendSignupEmail(current.email, captcha);
            if (attempt.current !== current) return;
            cooldown(); setNotice({ kind: 'success', text: t('authGate.emailResent') });
        } catch (error) {
            if (attempt.current !== current) return;
            if (error?.code === 'resend_restart') {
                reset(); editAddress(current.flow);
                setNotice({ kind: 'success', text: t('authGate.resendStartAgain') });
            } else {
                if (isEmailRateLimit(error)) cooldown();
                setNotice({ kind: 'error', text: humanAuthError(error, t) });
            }
        } finally {
            runningRef.current = false; setBusy(false); resetCaptcha();
            if (attempt.current === current) focusNotice();
        }
    }
    return { pending, count, seconds, begin, reset, changeAddress, resend };
}
