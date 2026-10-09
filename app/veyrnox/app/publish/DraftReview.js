'use client';

// Review of draft posts (ADR-0061 amendment, 0182): the weekly brand drafts
// wait here until the owner approves their batch. Nothing in a batch is
// published before then; discarding a draft cancels it.

import { useCallback, useEffect, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway.js';
import { NETWORKS } from '../../../lib/socialConnectClient.js';
import { approveDraftBatch, discardDrafts, listSocialDrafts } from '../../../lib/socialPostsClient.js';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const primaryButton = 'rounded-full bg-vx-accent text-black px-4 py-2 text-sm font-bold disabled:opacity-50';
const networkLabel = (key) => NETWORKS.find((n) => n.key === key)?.label || key;

function groupByBatch(drafts) {
    const batches = new Map();
    for (const d of drafts) {
        if (!batches.has(d.draft_batch_id)) batches.set(d.draft_batch_id, []);
        batches.get(d.draft_batch_id).push(d);
    }
    return [...batches.entries()].map(([id, posts]) => ({ id, posts }));
}

function Preview({ media }) {
    const [url, setUrl] = useState(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        if (!media) return undefined;
        gatewayFetch(`/jobs/${encodeURIComponent(media.job_id)}/asset`)
            .then((a) => { if (live) setUrl(a.url); })
            .catch(() => { if (live) setFailed(true); });
        return () => { live = false; };
    }, [media]);
    const box = 'h-24 w-24 shrink-0 rounded-lg bg-vx-panel overflow-hidden flex items-center justify-center';
    if (!media || failed) return <div className={`${box} text-xs text-vx-fg-muted`}>No preview</div>;
    if (!url) return <div className={box} aria-busy="true" />;
    return media.media_type === 'video'
        ? <video src={url} className={`${box} object-cover`} muted playsInline controls preload="metadata" />
        : <img src={url} alt="" className={`${box} object-cover`} />;
}

export function DraftReview({ onApproved }) {
    const [drafts, setDrafts] = useState(null);
    const [approvalEnabled, setApprovalEnabled] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(null);

    const load = useCallback(async () => {
        setError('');
        try {
            const res = await listSocialDrafts();
            setDrafts(res.drafts || []);
            setApprovalEnabled(res.approvalEnabled !== false);
        } catch {
            setError('Could not load your drafts.');
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    async function act(key, fn, message) {
        setBusy(key); setError('');
        try {
            const out = await fn();
            await load();
            return out;
        } catch {
            setError(message);
            return null;
        } finally {
            setBusy(null);
        }
    }

    if (drafts === null && !error) return <p className="text-sm text-vx-fg-muted">Loading…</p>;
    const batches = groupByBatch(drafts || []);

    return <div className="space-y-6">
        {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
        {!approvalEnabled && <p className="text-sm text-vx-fg-muted">Weekly drafts and batch approval are paused during the limited rollout. Use Compose to schedule a post or post now.</p>}
        {drafts && batches.length === 0 && (
            <p className="text-sm text-vx-fg-muted">{approvalEnabled ? 'No drafts waiting. Each Monday your generations from the past week arrive here as drafts.' : 'No drafts waiting.'}</p>
        )}
        {batches.map((batch) => (
            <div key={batch.id} className="rounded-xl border border-vx-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <span className="text-sm font-bold text-vx-fg">{batch.posts.length} draft{batch.posts.length === 1 ? '' : 's'}</span>
                    <div className="flex gap-2">
                        <button
                            type="button" className={button} disabled={busy !== null}
                            onClick={() => act(`discard:${batch.id}`, () => discardDrafts(batch.id), 'Could not discard this batch. Try again.')}
                        >
                            {busy === `discard:${batch.id}` ? 'Discarding…' : 'Discard all'}
                        </button>
                        <button
                            type="button" className={primaryButton} disabled={busy !== null || !approvalEnabled}
                            onClick={async () => {
                                const out = await act(`approve:${batch.id}`, () => approveDraftBatch(batch.id), 'Could not approve this batch. Try again.');
                                if (out && onApproved) onApproved(out);
                            }}
                        >
                            {busy === `approve:${batch.id}` ? 'Approving…' : `Approve ${batch.posts.length}`}
                        </button>
                    </div>
                </div>
                <ul className="space-y-3">
                    {batch.posts.map((p) => (
                        <li key={p.id} className="flex gap-3">
                            <Preview media={(p.media || [])[0]} />
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-vx-fg-muted">
                                    {new Date(p.scheduled_at).toLocaleString()} · {(p.networks || []).map(networkLabel).join(', ')}
                                </p>
                                {p.global_text && <p className="text-sm text-vx-fg mt-1 wrap-break-word">{p.global_text}</p>}
                                <button
                                    type="button" className="mt-2 text-xs font-bold text-vx-fg-muted underline disabled:opacity-50"
                                    disabled={busy !== null}
                                    onClick={() => act(`discard:${p.id}`, () => discardDrafts(batch.id, p.id), 'Could not discard that draft. Try again.')}
                                >
                                    {busy === `discard:${p.id}` ? 'Discarding…' : 'Discard'}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        ))}
    </div>;
}
