'use client';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

// Every live network's OAuth redirect target — app/api/v1/social/accounts/
// :network/{connect,callback}/route.js each hard-code their own
// CALLBACK_PATH as `/social/connect/callback/${network}`; this page reads
// that same network back out of its own URL. Mirrors app/auth/callback/
// page.js's shape: a bare landing page, no nav, that exchanges the
// one-time code and sends the browser back into the app.

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { NETWORKS, completeNetworkConnect, selectNetworkResource } from '../../../../lib/socialConnectClient.js';
import { Main } from '../../../../veyrnox/_components/Main.js';

function networkLabel(key) {
    return NETWORKS.find((n) => n.key === key)?.label || key;
}

export default function SocialConnectCallback() {
  const { t } = useI18n();

    const { network } = useParams();
    const [status, setStatus] = useState(t('social.connect.loading'));
    const [failed, setFailed] = useState(false);
    const [selection, setSelection] = useState(null);
    const [resourceId, setResourceId] = useState('');
    const [busy, setBusy] = useState(false);
    const started = useRef(null);

    useEffect(() => {
        if (started.current === network) return;
        started.current = network;
        if (!network || !NETWORKS.some((n) => n.key === network)) {
            setStatus(t('social.connect.unknown', { retry: t('social.connect.retry') }));
            setFailed(true);
            return;
        }
        const fail = (message) => { setStatus(message); setFailed(true); };
        if (!new URL(window.location.href).searchParams.get('code')) {
            fail(t('social.connect.noResponse', { retry: t('social.connect.retry') }));
            return;
        }
        completeNetworkConnect(network)
            .then((result) => {
                if (result?.selectionId && result?.choices?.length) {
                    setSelection(result);
                    setStatus(t('social.connect.select', { resource: tOr(t, `social.resource.${NETWORKS.find((n) => n.key === network)?.resource || 'destination'}`, NETWORKS.find((n) => n.key === network)?.resource || t('social.resource.destination')) }));
                } else if (result && result.ok) {
                    setStatus(t('social.connect.connected', { network: networkLabel(network) }));
                    window.location.replace('/app/publish');
                } else {
                    const code = result && result.code;
                    console.error('[social-connect-callback] connect failed', network, code);
                    fail(code === 'ACCOUNT_LIMIT' && result.limit === 5 ? t('social.connect.limitFive') : connectionError(code, t) || t('social.connect.failed', { network: networkLabel(network), retry: t('social.connect.retry') }));
                }
            })
            .catch((err) => {
                console.error('[social-connect-callback] unexpected failure', network, err);
                fail(t('social.connect.failed', { network: networkLabel(network), retry: t('social.connect.retry') }));
            });
    }, [network, t]);

    async function choose(event) {
        event.preventDefault(); setBusy(true); setFailed(false);
        try {
            const result = await selectNetworkResource(network, selection.selectionId, resourceId);
            if (!result.ok) throw new Error(result.code);
            window.location.replace('/app/publish');
        } catch (err) {
            setStatus(err.body?.code === 'ACCOUNT_LIMIT' && err.body?.limit === 5 ? t('social.connect.limitFive') : connectionError(err.body?.error || err.body?.code || err.message, t) || t('social.connect.destinationFailed', { retry: t('social.connect.retry') }));
            setFailed(true); setSelection(null);
        } finally { setBusy(false); }
    }

    return (
        <Main className="min-h-screen bg-vx-base text-vx-fg flex items-center justify-center px-6">
            <div className="text-center max-w-sm">
                <div className="text-sm text-zinc-400">{status}</div>
                {selection && <form onSubmit={choose} className="mt-4 space-y-4">
                    <label className="block text-sm">{t('social.connect.destination')}<select required value={resourceId} onChange={(e) => setResourceId(e.target.value)} disabled={busy}
                            className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3">
                            <option value="">{t('social.connect.choose')}</option>
                            {selection.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
                        </select>
                    </label>
                    <button disabled={busy || !resourceId} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy ? t('oauth.connecting') : t('social.connect.button')}</button>
                </form>}
                {failed && (
                    <a href="/app/publish" className="mt-4 inline-block text-sm text-white underline">{t('social.connect.back')}</a>
                )}
            </div>
        </Main>
    );
}

function connectionError(code, t) {
        const key = { NO_YOUTUBE_CHANNEL: 'channel', ACCOUNT_LIMIT: 'limitOne', NO_ELIGIBLE_RESOURCE: 'noResource', selection_expired: 'expired', VERIFIER_MISSING: 'browser', invalid_state: 'used', not_authenticated: 'signedOut' }[code];
        return key ? tOr(t, `social.connect.${key}`, code, { retry: t('social.connect.retry') }) : '';
}
