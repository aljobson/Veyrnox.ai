'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { useState } from 'react';
import { connectBluesky } from '../../../lib/socialConnectClient.js';

export default function BlueskyConnect({ onConnected, onCancel }) {
  const { t } = useI18n();
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function submit(event) {
        event.preventDefault();
        setError(''); setBusy(true);
        const appPassword = password;
        setPassword('');
        try {
            await connectBluesky(identifier.trim(), appPassword);
            await onConnected();
        } catch (err) {
            setError(err.body?.code === 'ACCOUNT_LIMIT' ? (err.body.limit === 5 ? t("app.publish.bluesky.planLimit") : t("app.publish.bluesky.freeLimit"))
                : err.body?.stage === 'record_account' ? t("app.publish.bluesky.saveFailed")
                : err.body?.stage === 'provider_session' && !['provider_request_failed_400', 'provider_request_failed_401'].includes(err.body?.code) ? t("app.publish.bluesky.sessionFailed")
                : t("app.publish.bluesky.failed"));
        } finally { setBusy(false); }
    }
    return <form onSubmit={submit} className="space-y-3 rounded-xl border border-vx-border p-4">
        <h3 className="font-bold">{t("app.publish.bluesky.connect")}</h3>
        <p className="text-sm text-vx-fg-muted">{t("app.publish.bluesky.instructions")}</p>
        <label className="block text-sm">{t("app.publish.bluesky.handle")}<input required autoComplete="off" value={identifier} onChange={(e) => setIdentifier(e.target.value)} maxLength={253}
                placeholder="you.bsky.social" className="mt-1 w-full rounded-lg border border-vx-border bg-transparent p-2" />
        </label>
        <label className="block text-sm">{t("app.publish.bluesky.password")}<input required type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={19}
                pattern="[a-z0-9]{4}(-[a-z0-9]{4}){3}" title={t("app.publish.bluesky.passwordFormat")} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent p-2" />
        </label>
        {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
        <div className="flex gap-3">
            <button disabled={busy} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy ? t("oauth.connecting") : t("app.publish.bluesky.connect")}</button>
            <button type="button" disabled={busy} onClick={onCancel} className="rounded-full border border-vx-border px-4 py-2 text-sm font-bold">{t("cinema.creatorWorkspace.cancel")}</button>
        </div>
    </form>;
}
