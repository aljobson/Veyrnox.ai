"use client";

export default function EmailResendControls({ state, busy, t }) {
    const limited = state.count >= 5;
    const cooling = state.seconds > 0;
    return <div className={state.pending ? "space-y-3" : "sr-only"}>
        {state.pending && <button type="button" onClick={state.resend} disabled={busy || cooling || limited}
            aria-label={t('authGate.resendEmailTo', { email: state.pending.email })}
            className="min-h-11 w-full rounded-xl bg-vx-accent text-vx-accent-ink px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-60">
            {cooling ? t('authGate.resendIn', { seconds: state.seconds }) : t('authGate.resendEmail')}
        </button>}
        <p role="status" aria-live="polite" className={limited ? 'text-sm text-vx-fg-muted' : 'sr-only'}>
            {state.pending ? limited ? t('authGate.resendLimit') : cooling ? t('authGate.resendIn', { seconds: 60 }) : t('authGate.resendReady') : ''}
        </p>
        {state.pending && <button type="button" disabled={busy} onClick={state.changeAddress}
            className="min-h-11 w-full rounded-xl px-3 py-3 text-sm text-vx-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-60">
            {t('authGate.changeAddress')}
        </button>}
    </div>;
}
