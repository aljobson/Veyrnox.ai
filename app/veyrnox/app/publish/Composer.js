'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import DeviceUploads from './DeviceUploads.js';
import NetworkLogo from './NetworkLogo.js';
import { gatewayFetch } from '../../_lib/gateway.js';
import { ownedPublishUpload } from '../../_lib/editorDelivery.mjs';
import { NETWORKS } from '../../../lib/socialConnectClient.js';
import { createSocialPost, listSocialPosts, newIdempotencyKey } from '../../../lib/socialPostsClient.js';
import { deleteSocialPreset, listSocialPresets, saveSocialPreset } from '../../../lib/socialPresetsClient.js';

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

function ContentPresets({ accounts, caption, selectedAccountIds, onApply }) {
    const [presets, setPresets] = useState(null);
    const [selectedId, setSelectedId] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const result = await listSocialPresets();
            setPresets(result.presets || []);
        } catch {
            setError('Could not load your saved presets.');
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    function apply() {
        const preset = (presets || []).find((item) => item.id === selectedId);
        if (!preset) { setError('Choose a saved preset first.'); return; }
        const availableIds = new Set(accounts.map((account) => account.id));
        onApply(preset.caption, (preset.account_ids || []).filter((id) => availableIds.has(id)));
        setName(preset.name); setError('');
        setMessage('Preset loaded. Review everything before posting.');
    }

    async function save() {
        const cleanName = name.trim();
        if (!cleanName) { setError('Give this preset a name.'); return; }
        if (!caption) { setError('Write a caption before saving a preset.'); return; }
        setBusy(true); setError(''); setMessage('');
        try {
            const existing = (presets || []).find((item) => item.id === selectedId);
            const result = await saveSocialPreset({ id: existing?.id || null, name: cleanName, caption, accountIds: [...selectedAccountIds] });
            await load(); setSelectedId(result.preset_id); setMessage(existing ? 'Preset updated.' : 'Preset saved.');
        } catch (err) {
            setError(err?.body?.error === 'preset_name_taken' ? 'A preset with that name already exists.' : 'Could not save that preset. Try again.');
        } finally { setBusy(false); }
    }

    async function remove() {
        if (!selectedId) { setError('Choose a saved preset first.'); return; }
        setBusy(true); setError(''); setMessage('');
        try {
            await deleteSocialPreset(selectedId);
            setSelectedId(''); setName(''); await load(); setMessage('Preset deleted.');
        } catch { setError('Could not delete that preset. Try again.'); }
        finally { setBusy(false); }
    }

    return <section aria-label="Saved content presets" className="rounded-xl border border-vx-border p-3 space-y-3">
        <div>
            <h3 className="text-sm font-bold">Saved captions and destinations</h3>
            <p className="text-xs text-vx-fg-muted">Reuse caption text and connected accounts. Media is always chosen separately.</p>
        </div>
        <div className="flex flex-wrap gap-2">
            <select aria-label="Saved preset" value={selectedId} disabled={busy || presets === null} onChange={(e) => { const id=e.target.value; setSelectedId(id); setName((presets || []).find((item)=>item.id===id)?.name || ''); setError(''); setMessage(''); }} className="min-w-48 rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm">
                <option value="">{presets === null ? 'Loading presets…' : presets.length ? 'Choose a preset' : 'No saved presets'}</option>
                {(presets || []).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <button type="button" className={button} disabled={busy || !selectedId} onClick={apply}>Apply preset</button>
            <button type="button" className={button} disabled={busy || !selectedId} onClick={remove}>Delete</button>
        </div>
        <div className="flex flex-wrap gap-2">
            <label htmlFor="preset-name" className="sr-only">Preset name</label>
            <input id="preset-name" value={name} maxLength={80} onChange={(e)=>setName(e.target.value)} placeholder="Preset name" className="min-w-56 flex-1 rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm" />
            <button type="button" className={button} disabled={busy} onClick={save}>{busy ? 'Saving…' : selectedId ? 'Update preset' : 'Save current'}</button>
        </div>
        {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
        {message && <p role="status" className="text-sm text-vx-accent">{message}</p>}
    </section>;
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

export function Composer({ accounts, onScheduled, initialJobId = null, initialUploadId = null, reusablePost = null, uploadsEnabled = false, youtubeVisibilityEnabled = false, scheduleEnabled = true, multiAccountEnabled = true, presetsEnabled = false }) {
    const activeAccounts = (accounts || []).filter((a) => a.status === 'active' && a.publishingEnabled !== false && (a.supportedMedia || NETWORKS.find((n) => n.key === a.network)?.media.filter(t => t !== 'video' || a.network === 'youtube'))?.length);
    const [selectedAccountIds, setSelectedAccountIds] = useState(() => new Set());
    const [caption, setCaption] = useState('');
    const [youtubeVisibility, setYoutubeVisibility] = useState('private');
    const hasYoutube = activeAccounts.some((a) => a.network === 'youtube' && selectedAccountIds.has(a.id));
    const [scheduledAt, setScheduledAt] = useState(defaultScheduleValue);
    const [mediaType, setMediaType] = useState('image');
    const hasTiktokVideo = mediaType === 'video' && activeAccounts.some((a) => a.network === 'tiktok' && selectedAccountIds.has(a.id));
    const [selectedMedia, setSelectedMedia] = useState(null);
    const [loadingMedia, setLoadingMedia] = useState(!!initialJobId || !!initialUploadId);
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

    useEffect(() => {
        if (!initialUploadId || initialJobId) return;
        let active = true;
        Promise.resolve().then(async () => {
            if (!active) return null;
            if (!uploadsEnabled) throw new Error('uploads disabled');
            setLoadingMedia(true);
            return ownedPublishUpload(gatewayFetch, initialUploadId);
        }).then(media => {
            if (active && media) { setSelectedMedia(media); setMediaType('video'); setMediaError(''); }
        }).catch(() => { if (active) setMediaError(uploadsEnabled ? 'This upload is unavailable for your account. Choose an image or video from your library or device.' : 'Video uploads are not open here yet.'); })
            .finally(() => { if (active) setLoadingMedia(false); });
        return () => { active = false; };
    }, [initialUploadId, initialJobId, uploadsEnabled]);

    useEffect(() => {
        if (!reusablePost?.reuseKey) return;
        let active = true;
        Promise.resolve().then(async () => {
            if (!active) return;
            const source = reusablePost.media?.[0];
            setCaption(reusablePost.global_text || '');
            setSelectedAccountIds(new Set((reusablePost.targets || []).map((target) => target.account_id).filter((id) => activeAccounts.some((account) => account.id === id))));
            setSuccess('Previous post loaded. Review everything before posting again.');
            setError(''); setMediaError(''); setSelectedMedia(null);
            idempotencyKey.current = newIdempotencyKey();
            if (!source) { setMediaError('The previous post has no reusable media. Choose media below.'); return; }
            setLoadingMedia(true);
            const media = source.job_id
                ? await gatewayFetch(`/jobs/${encodeURIComponent(source.job_id)}/asset`).then((asset) => ({ jobId: source.job_id, thumbUrl: asset.url, mediaType: source.media_type }))
                : uploadsEnabled && source.upload_id
                    ? await ownedPublishUpload(gatewayFetch, source.upload_id)
                    : await Promise.reject(new Error('media unavailable'));
            if (active) { setSelectedMedia(media); setMediaType(media.mediaType); }
        }).catch(() => { if (active) setMediaError('That post’s media is no longer available. Choose another image or video.'); })
            .finally(() => { if (active) setLoadingMedia(false); });
        return () => { active = false; };
    // activeAccounts is derived from the account prop; the reuse key is the intentional trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reusablePost?.reuseKey, uploadsEnabled]);

    function toggleAccount(id) {
        setSelectedAccountIds((prev) => {
            if (!multiAccountEnabled && !prev.has(id)) return new Set([id]);
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
        for (const id of selectedAccountIds) {
            const account = activeAccounts.find((a) => a.id === id);
            const network = NETWORKS.find((n) => n.key === account?.network);
            if (!(account?.supportedMedia || network?.media.filter(t => t !== 'video' || account?.network === 'youtube'))?.includes(mediaType)) { setError(`${network?.label || 'That account'} does not support this media type.`); return; }
            const length = network.key === 'bluesky' ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(caption)].length : [...caption].length;
            if (length > network.captionLimit) { setError(`${network.label} supports captions up to ${network.captionLimit} characters.`); return; }
        }
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
                ...(hasYoutube && youtubeVisibilityEnabled ? { youtubeVisibility } : {}),
                idempotencyKey: idempotencyKey.current,
                accountIds: [...selectedAccountIds],
                media: [{ mediaType, ...(selectedMedia.uploadId ? { uploadId: selectedMedia.uploadId } : { jobId: selectedMedia.jobId }) }],
            });
            setSuccess(publishNow ? 'Post queued for publishing. It can take a few minutes to appear.' : 'Post scheduled.');
            setCaption(''); setSelectedAccountIds(new Set()); setSelectedMedia(null);
            setScheduledAt(defaultScheduleValue());
            setYoutubeVisibility('private');
            idempotencyKey.current = newIdempotencyKey();
            onScheduled?.();
        } catch (err) {
            const code = err && err.code;
            setError(code === 'rate_limited'
                ? 'Too many posts scheduled at once. Wait a moment and try again.'
                : ['unsupported_media_type', 'publishing_not_supported'].includes(err.body?.error) ? 'That destination does not support this media type.'
                : err.body?.error === 'caption_too_long' ? 'The caption is too long for a selected platform.'
                : 'Could not submit that post. Check your connection and try again.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div>
                <div className="text-sm font-bold mb-2">Post to</div>
                {!activeAccounts.length && <p className="text-sm text-vx-fg-muted">Connect a publishing account above before creating a post. Twitch connects for statistics. You can choose media first.</p>}
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
                {!multiAccountEnabled && activeAccounts.length > 1 && <p className="mt-2 text-xs text-vx-fg-muted">Free posts to one account at a time. <Link href="/app/publish/plan" className="font-bold text-vx-accent underline">Upgrade for multi-account publishing</Link>.</p>}
            </div>

            {hasTiktokVideo && <p className="text-sm text-vx-fg-muted">TikTok receives an inbox draft at the chosen time. Finish caption, any AI disclosure and posting in TikTok; this does not publish automatically.</p>}

            {hasYoutube && <div>
                {youtubeVisibilityEnabled ? <>
                    <label htmlFor="youtube-visibility" className="text-sm font-bold mb-2 block">YouTube visibility</label>
                    <select id="youtube-visibility" value={youtubeVisibility} onChange={(e) => setYoutubeVisibility(e.target.value)} disabled={Boolean(submitting)} className="rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm">
                        <option value="private">Private</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="public">Public</option>
                    </select>
                    <p className="text-sm text-vx-fg-muted mt-2">{youtubeVisibility === 'private' ? 'Only you and people you invite on YouTube can watch.' : youtubeVisibility === 'unlisted' ? 'Anyone with the YouTube link can watch.' : 'Anyone can find and watch this video on YouTube.'} This applies only to YouTube.</p>
                </> : <p className="text-sm text-vx-fg-muted">YouTube videos will be posted publicly.</p>}
            </div>}

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

            {presetsEnabled && <ContentPresets accounts={activeAccounts} caption={caption} selectedAccountIds={selectedAccountIds}
                onApply={(nextCaption, accountIds) => { setCaption(nextCaption); setSelectedAccountIds(new Set(accountIds)); setError(''); setSuccess(''); idempotencyKey.current = newIdempotencyKey(); }} />}

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
                        ? <video src={selectedMedia.thumbUrl} aria-label="Selected video" controls playsInline className="h-24 w-40 rounded-sm object-contain" />
                        : <img src={selectedMedia.thumbUrl} alt="Selected image" className="h-10 w-10 rounded-sm object-cover" />)}
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

            {scheduleEnabled ? <div>
                <label htmlFor="publish-schedule" className="text-sm font-bold mb-2 block">Schedule for</label>
                <input id="publish-schedule" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm" />
            </div> : <p className="rounded-xl border border-vx-accent/40 bg-vx-accent/[0.06] p-3 text-sm text-vx-fg-body">
                Post now is included with Free. <Link href="/app/publish/plan" className="font-bold text-vx-accent underline">Upgrade to schedule posts</Link>.
            </p>}

            {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
            {success && <p className="text-sm text-vx-accent">{success}</p>}

            <div className="flex flex-wrap gap-3">
                <button type="submit" value="now" formNoValidate disabled={submitting || loadingMedia || uploading || !activeAccounts.length} className={primaryButton}>
                    {submitting === 'now' ? 'Submitting…' : 'Post now'}
                </button>
                {scheduleEnabled && <button type="submit" value="schedule" disabled={submitting || loadingMedia || uploading || !activeAccounts.length} className={button}>
                    {submitting === 'schedule' ? 'Scheduling…' : 'Schedule post'}
                </button>}
            </div>
            <p className="text-xs text-vx-fg-muted">Post now starts publishing as soon as possible.{scheduleEnabled ? ' Schedule post uses the date and time above.' : ''} Publishing can take a few minutes.</p>
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

export function ScheduledPosts({ refreshToken, scheduleEnabled = true, onReuse }) {
    const [posts, setPosts] = useState(null);
    const [query, setQuery] = useState('');
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [loadError, setLoadError] = useState('');

    const load = useCallback(async () => {
        setLoadError('');
        try {
            const res = await listSocialPosts({ limit: 50 });
            setPosts(res.posts || []);
            setCalendarOpen(res.calendarEnabled === true);
        } catch {
            setLoadError('Could not load your scheduled posts.');
        }
    }, []);
    useEffect(() => { load(); }, [load, refreshToken]);

    if (loadError) return <p role="alert" className="text-sm text-vx-danger">{loadError}</p>;
    if (posts === null) return <p className="text-sm text-vx-fg-muted">Loading…</p>;

    const visible = posts.filter((post) => !query || `${post.global_text || ''} ${(post.targets || []).map((target) => networkLabel(target.network)).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    return (
        <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
            {calendarOpen && scheduleEnabled && <Link href="/app/publish/calendar" className="text-sm text-vx-accent underline">Open calendar</Link>}
            {scheduleEnabled && posts.length > 0 && <label className="ml-auto text-sm"><span className="sr-only">Search previous posts</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search previous posts" className="rounded-full border border-vx-border bg-transparent px-4 py-2 text-sm" /></label>}
        </div>
        {posts.length === 0 && <p className="text-sm text-vx-fg-muted">Nothing scheduled yet.</p>}
        {posts.length > 0 && visible.length === 0 && <p className="text-sm text-vx-fg-muted">No previous posts match that search.</p>}
        <ul className="space-y-3">
            {visible.map((p) => (
                <li key={p.id} className="rounded-xl border border-vx-border p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-xs font-bold text-vx-fg-muted">
                            {p.status} · {new Date(p.scheduled_at).toLocaleString()}
                        </span>
                        {scheduleEnabled && (p.media || []).length > 0 && <button type="button" className={button} onClick={() => onReuse?.(p)}>Use again</button>}
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
