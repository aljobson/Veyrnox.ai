'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import DeviceUploads from './DeviceUploads.js';
import NetworkLogo from './NetworkLogo.js';
import { gatewayFetch } from '../../_lib/gateway.js';
import { NETWORKS } from '../../../lib/socialConnectClient.js';
import { createSocialPost, listSocialPosts, newIdempotencyKey } from '../../../lib/socialPostsClient.js';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const primaryButton = 'rounded-full bg-vx-accent text-black px-4 py-2 text-sm font-bold disabled:opacity-50';

function networkLabel(key) {
    return NETWORKS.find((n) => n.key === key)?.label || key;
}

function defaultScheduleValue() {
    // Local time an hour out, trimmed to what <input type="datetime-local"> accepts.
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

/** The account's own recent library, single-select, for the composer's one media slot. */
function MediaPicker({ selected, onSelect }) {
    const [jobs, setJobs] = useState(null);
    const [thumbs, setThumbs] = useState({});
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await gatewayFetch('/jobs?limit=24');
                const withAssets = (res.jobs || []).filter((j) => j.has_asset);
                if (cancelled) return;

                const entries = await Promise.all(withAssets.map(async (j) => {
                    try {
                        const asset = await gatewayFetch(`/jobs/${encodeURIComponent(j.job_id)}/asset`);
                        return [j.job_id, { url: asset.url, mediaType: asset.mime_type?.split('/')[0] }];
                    } catch {
                        return [j.job_id, null];
                    }
                }));
                if (!cancelled) {
                    const loaded = Object.fromEntries(entries);
                    setThumbs(loaded);
                    setJobs(withAssets.filter((j) => ['image', 'video'].includes(loaded[j.job_id]?.mediaType)));
                }
            } catch {
                if (!cancelled) setLoadError('Could not load your library. Check your connection and try again.');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (loadError) return <p role="alert" className="text-sm text-vx-danger">{loadError}</p>;
    if (jobs === null) return <p className="text-sm text-vx-fg-muted">Loading your library…</p>;
    if (jobs.length === 0) return <p className="text-sm text-vx-fg-muted">No generated images or videos in this library yet.</p>;

    return (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
            {jobs.map((j) => {
                const isSelected = selected?.jobId === j.job_id;
                return (
                    <button
                        key={j.job_id}
                        type="button"
                        aria-label={`Choose ${thumbs[j.job_id]?.mediaType || 'media'} ${j.job_id.slice(0, 8)}`}
                        aria-pressed={isSelected}
                        onClick={() => onSelect({ jobId: j.job_id, thumbUrl: thumbs[j.job_id]?.url, mediaType: thumbs[j.job_id]?.mediaType })}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 ${isSelected ? 'border-vx-accent' : 'border-vx-border'}`}
                    >
                        {thumbs[j.job_id]
                            ? thumbs[j.job_id]?.mediaType === 'video'
                                ? <video src={thumbs[j.job_id]?.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                                : <img src={thumbs[j.job_id]?.url} alt="" className="h-full w-full object-cover" />
                            : <span className="flex h-full w-full items-center justify-center bg-vx-panel text-xs text-vx-fg-muted">…</span>}
                        {isSelected && <span aria-hidden="true" className="absolute inset-0 bg-vx-accent/20" />}
                    </button>
                );
            })}
        </div>
    );
}

export function Composer({ accounts, onScheduled, initialJobId = null, uploadsEnabled = false }) {
    const activeAccounts = (accounts || []).filter((a) => a.status === 'active');
    const [selectedAccountIds, setSelectedAccountIds] = useState(() => new Set());
    const [caption, setCaption] = useState('');
    const [scheduledAt, setScheduledAt] = useState(defaultScheduleValue);
    const [mediaType, setMediaType] = useState('image');
    const [selectedMedia, setSelectedMedia] = useState(null);
    const [loadingMedia, setLoadingMedia] = useState(!!initialJobId);
    const [mediaError, setMediaError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const idempotencyKey = useRef(newIdempotencyKey());

    useEffect(() => {
        if (!initialJobId) return;
        let cancelled = false;
        (async () => {
            try {
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(initialJobId)) throw new Error('invalid job');
                const asset = await gatewayFetch(`/jobs/${encodeURIComponent(initialJobId)}/asset`);
                const type = asset.mime_type?.split('/')[0];
                if (!asset.url || !['image', 'video'].includes(type)) throw new Error('unsupported media');
                if (cancelled) return;
                setMediaType(type);
                setSelectedMedia({ jobId: initialJobId, thumbUrl: asset.url });
            } catch {
                if (!cancelled) setMediaError('This generation is unavailable or cannot be posted. Choose an image or video from your library.');
            } finally {
                if (!cancelled) setLoadingMedia(false);
            }
        })();
        return () => { cancelled = true; };
    }, [initialJobId]);

    function toggleAccount(id) {
        setSelectedAccountIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    async function onSubmit(e) {
        e.preventDefault();
        setError(''); setSuccess('');
        if (selectedAccountIds.size === 0) { setError('Pick at least one connected account.'); return; }
        if (!selectedMedia) { setError('Choose an image or video from your library or device.'); return; }
        const publishNow = e.nativeEvent.submitter?.value === 'now';
        const schedule = new Date(scheduledAt);
        if (!publishNow && (!Number.isFinite(schedule.getTime()) || schedule.getTime() <= Date.now())) {
            setError('Choose a future date and time to schedule your post.'); return;
        }
        setSubmitting(publishNow ? 'now' : 'schedule');
        try {
            await createSocialPost({
                ...(publishNow ? { publishNow: true } : { scheduledAt: schedule.toISOString() }),
                globalText: caption,
                idempotencyKey: idempotencyKey.current,
                accountIds: [...selectedAccountIds],
                media: [{ mediaType, ...(selectedMedia.uploadId ? { uploadId: selectedMedia.uploadId } : { jobId: selectedMedia.jobId }) }],
            });
            setSuccess(publishNow ? 'Post queued for publishing. It can take a few minutes to appear.' : 'Post scheduled.');
            setCaption(''); setSelectedAccountIds(new Set()); setSelectedMedia(null);
            setScheduledAt(defaultScheduleValue());
            idempotencyKey.current = newIdempotencyKey();
            onScheduled?.();
        } catch (err) {
            const code = err && err.code;
            setError(code === 'rate_limited'
                ? 'Too many posts scheduled at once. Wait a moment and try again.'
                : 'Could not submit that post. Check your connection and try again.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div>
                <div className="text-sm font-bold mb-2">Post to</div>
                {!activeAccounts.length && <p className="text-sm text-vx-fg-muted">Connect an account above before scheduling a post. You can choose media first.</p>}
                <ul className="flex flex-wrap gap-2">
                    {activeAccounts.map((a) => {
                        const on = selectedAccountIds.has(a.id);
                        return (
                            <li key={a.id}>
                                <button
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => toggleAccount(a.id)}
                                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold ${on ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg'}`}
                                >
                                    <NetworkLogo network={a.network} className="h-4 w-4" />
                                    {networkLabel(a.network)}: {a.display_name || a.external_account_id}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>

            <div>
                <label htmlFor="publish-caption" className="text-sm font-bold mb-2 block">Caption</label>
                <textarea
                    id="publish-caption"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value.slice(0, 4000))}
                    rows={4}
                    className="w-full rounded-xl border border-vx-border bg-transparent p-3 text-sm"
                    placeholder="Write a caption…"
                />
            </div>

            <div>
                <div className="text-sm font-bold mb-2">Media</div>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                    <select aria-label="Media type" disabled={uploading || Boolean(selectedMedia?.uploadId)} value={mediaType} onChange={(e) => setMediaType(e.target.value)} className="rounded-lg border border-vx-border bg-transparent px-2 py-1 text-sm">
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                    </select>
                    <button type="button" disabled={loadingMedia || uploading} className={button} onClick={() => setPickerOpen((v) => !v)}>
                        {selectedMedia ? 'Change' : 'Choose from library'}
                    </button>
                    {selectedMedia?.thumbUrl && (mediaType === 'video'
                        ? <video src={selectedMedia.thumbUrl} aria-label="Selected video" controls playsInline className="h-24 w-40 rounded object-contain" />
                        : <img src={selectedMedia.thumbUrl} alt="Selected image" className="h-10 w-10 rounded object-cover" />)}
                </div>
                {loadingMedia && <p role="status" className="text-sm text-vx-fg-muted">Loading your generation…</p>}
                {mediaError && <p role="alert" className="text-sm text-vx-danger">{mediaError}</p>}
                {selectedMedia && <p className="text-sm text-vx-fg-muted">Media selected. Choose accounts, add a caption and confirm when to post.</p>}
                {uploadsEnabled && <DeviceUploads selected={selectedMedia} onBusyChange={setUploading} onSelect={(m) => { setSelectedMedia(m); if (m) setMediaType(m.mediaType); setMediaError(''); setPickerOpen(false); }} />}
                {pickerOpen && (
                    <MediaPicker
                        selected={selectedMedia}
                        onSelect={(m) => { setSelectedMedia(m); setMediaType(m.mediaType); setMediaError(''); setPickerOpen(false); }}
                    />
                )}
            </div>

            <div>
                <label htmlFor="publish-schedule" className="text-sm font-bold mb-2 block">Schedule for</label>
                <input
                    id="publish-schedule"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm"
                />
            </div>

            {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
            {success && <p className="text-sm text-vx-accent">{success}</p>}

            <div className="flex flex-wrap gap-3">
                <button type="submit" value="now" formNoValidate disabled={submitting || loadingMedia || uploading || !activeAccounts.length} className={primaryButton}>
                    {submitting === 'now' ? 'Submitting…' : 'Post now'}
                </button>
                <button type="submit" value="schedule" disabled={submitting || loadingMedia || uploading || !activeAccounts.length} className={button}>
                    {submitting === 'schedule' ? 'Scheduling…' : 'Schedule post'}
                </button>
            </div>
            <p className="text-xs text-vx-fg-muted">Post now starts publishing as soon as possible. Schedule post uses the date and time above. Publishing can take a few minutes.</p>
        </form>
    );
}

// 'delivered' (TikTok's MEDIA_UPLOAD outcome, ADR-0061 Phase 5) means the
// content reached the creator's TikTok inbox as a draft — not itself a
// live post, so it gets its own honest label rather than reading as
// "published".
const STATUS_LABEL = { delivered: 'delivered — finish in TikTok app', submitted: 'in progress' };

function TargetBadge({ target }) {
    const tone = target.publish_status === 'published' || target.publish_status === 'delivered' ? 'text-vx-accent'
        : target.publish_status === 'failed' ? 'text-vx-danger' : 'text-vx-fg-muted';
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${tone}`} title={target.last_error || ''}>
            <NetworkLogo network={target.network} className="h-3.5 w-3.5" />
            {networkLabel(target.network)}: {STATUS_LABEL[target.publish_status] || target.publish_status}
            {target.platform_post_url && target.publish_status === 'published' && (
                <> · <a href={target.platform_post_url} target="_blank" rel="noreferrer" className="underline">view</a></>
            )}
        </span>
    );
}

export function ScheduledPosts({ refreshToken }) {
    const [posts, setPosts] = useState(null);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [loadError, setLoadError] = useState('');

    const load = useCallback(async () => {
        setLoadError('');
        try {
            const res = await listSocialPosts();
            setPosts(res.posts || []);
            setCalendarOpen(res.calendarEnabled === true);
        } catch {
            setLoadError('Could not load your scheduled posts.');
        }
    }, []);
    useEffect(() => { load(); }, [load, refreshToken]);

    if (loadError) return <p role="alert" className="text-sm text-vx-danger">{loadError}</p>;
    if (posts === null) return <p className="text-sm text-vx-fg-muted">Loading…</p>;

    return (
        <div>
        {calendarOpen && <Link href="/app/publish/calendar" className="inline-block text-sm text-vx-accent underline mb-4">Open calendar</Link>}
        {posts.length === 0 && <p className="text-sm text-vx-fg-muted">Nothing scheduled yet.</p>}
        <ul className="space-y-3">
            {posts.map((p) => (
                <li key={p.id} className="rounded-xl border border-vx-border p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-xs font-bold text-vx-fg-muted">
                            {p.status} · {new Date(p.scheduled_at).toLocaleString()}
                        </span>
                    </div>
                    {p.global_text && <p className="text-sm text-vx-fg mb-2 line-clamp-2">{p.global_text}</p>}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {(p.targets || []).map((t) => <TargetBadge key={t.id} target={t} />)}
                    </div>
                </li>
            ))}
        </ul>
        </div>
    );
}
