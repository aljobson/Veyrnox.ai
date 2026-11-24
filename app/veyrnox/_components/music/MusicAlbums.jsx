'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gatewayFetch } from '../../_lib/gateway';
import { MusicPrivateAudio } from '../../_lib/useMusicAudioSrc';
import { useI18n } from '../../../../components/I18nProvider';

const key = (prefix) => `${prefix}.${crypto.randomUUID()}`;

export function MusicAlbums() {
  const { t } = useI18n();
  const [albums, setAlbums] = useState([]); const [playlists, setPlaylists] = useState([]); const [images, setImages] = useState([]); const [trackOptions, setTrackOptions] = useState([]); const [selectedTracks, setSelectedTracks] = useState([]);
  const [activeId, setActiveId] = useState(''); const [title, setTitle] = useState('');
  const [description, setDescription] = useState(''); const [albumType, setAlbumType] = useState('album'); const [playlistId, setPlaylistId] = useState('');
  const [createTitle, setCreateTitle] = useState(''); const [createDescription, setCreateDescription] = useState('');
  const [createType, setCreateType] = useState('album'); const [createArtwork, setCreateArtwork] = useState(''); const [artwork, setArtwork] = useState('');
  const [busy, setBusy] = useState(''); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const [albumPage, playlistPage, artworkPage] = await Promise.all([
        gatewayFetch('/music/albums', { promptOnAuth: false }),
        gatewayFetch('/music/playlists', { promptOnAuth: false }),
        gatewayFetch('/music/albums/artwork', { promptOnAuth: false }),
      ]);
      setAlbums(albumPage.albums || []); setTrackOptions(albumPage.available_tracks || []); setPlaylists(playlistPage.playlists || []);
      setImages((artworkPage.images || []).filter((image) => image && typeof image.asset_id === 'string' && typeof image.job_id === 'string'));
      setActiveId((current) => current || albumPage.albums?.[0]?.id || '');
    } catch { setError(t('music.album.owner.loadFailed')); }
  }, [t]);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  const active = useMemo(() => albums.find((album) => album.id === activeId) || null, [activeId, albums]);
  useEffect(() => { if (active) { setTitle(active.title); setDescription(active.description || ''); setAlbumType(active.album_type || 'album'); setArtwork(active.artwork_asset_id || ''); setSelectedTracks(active.tracks.map((track) => track.publication_id)); } }, [active]);
  async function create(event) {
    event.preventDefault(); if (!createTitle.trim()) return; setBusy('create'); setError(''); setNotice('');
    try {
      const payload = { title: createTitle.trim(), album_type: createType, description: createDescription.trim(), artwork_asset_id: createArtwork || null, idempotency_key: key('album-create') };
      const response = playlistId
        ? await gatewayFetch('/music/albums/from-playlist', { method: 'POST', body: JSON.stringify({ ...payload, playlist_id: playlistId }) })
        : await gatewayFetch('/music/albums', { method: 'POST', body: JSON.stringify(payload) });
      setNotice(playlistId ? t('music.album.owner.converted', { included: response.included_count, excluded: response.excluded_count }) : t('music.album.owner.created'));
      setActiveId(response.album.id); setPlaylistId(''); setCreateTitle(''); setCreateDescription(''); setCreateType('album'); setCreateArtwork(''); await load();
    } catch { setError(t('music.album.owner.createFailed')); } finally { setBusy(''); }
  }
  async function patch(action, extra = {}) {
    if (!active) return; setBusy(action); setError(''); setNotice('');
    try {
      const response = await gatewayFetch(`/music/albums/${active.id}`, { method: 'PATCH', body: JSON.stringify({ action,
        expected_revision: active.revision, idempotency_key: key(`album-${action}`), ...extra }) });
      if (action === 'delete') { setNotice(t('music.album.owner.removed')); setActiveId(''); }
      else { setNotice(t(action === 'publish' ? 'music.album.owner.published' : action === 'unpublish' ? 'music.album.owner.unpublished' : 'music.album.owner.saved')); setActiveId(response.album.id); }
      await load();
    } catch (reason) {
      setError(t(reason?.code === 'revision_conflict' ? 'music.album.owner.revisionConflict'
        : reason?.code === 'album_not_ready' ? 'music.album.owner.notReady' : 'music.album.owner.changeFailed'));
      await load();
    } finally { setBusy(''); }
  }
  function move(index, by) {
    const ids = active.tracks.map((track) => track.publication_id); const next = index + by;
    if (next < 0 || next >= ids.length) return; [ids[index], ids[next]] = [ids[next], ids[index]];
    return patch('replace', { publication_ids: ids });
  }
  function toggleTrack(publicationId) {
    setSelectedTracks((current) => current.includes(publicationId) ? current.filter((id) => id !== publicationId)
      : current.length < 50 ? [...current, publicationId] : current);
  }
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
    <header><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('music.album.owner.eyebrow')}</p>
      <h1 className="mt-2 font-vx text-4xl font-black sm:text-5xl">{t('music.album.owner.title')}</h1>
      <p className="mt-3 max-w-3xl text-vx-fg-body">{t('music.album.owner.description')}</p></header>
    {error ? <p role="alert" className="mt-6 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
    {notice ? <p role="status" className="mt-6 rounded-xl border border-vx-accent/40 bg-vx-accent/10 p-3 text-sm">{notice}</p> : null}
    <form onSubmit={create} className="mt-8 grid gap-3 rounded-2xl border border-vx-border bg-vx-panel p-5 sm:grid-cols-2">
      <label className="text-sm font-bold">{t('music.album.owner.albumTitle')}<input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} maxLength={80} required className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-4" /></label>
      <label className="text-sm font-bold">{t('music.album.owner.releaseType')}<select value={createType} onChange={(event) => setCreateType(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-4"><option value="album">{t('music.album.owner.lp')}</option><option value="ep">{t('music.album.ep')}</option><option value="single">{t('music.album.single')}</option></select></label>
      <label className="text-sm font-bold sm:col-span-2">{t('music.album.owner.startPlaylist')}<select value={playlistId} onChange={(event) => setPlaylistId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-4"><option value="">{t('music.album.owner.blankDraft')}</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title}</option>)}</select></label>
      <label className="text-sm font-bold sm:col-span-2">{t('music.album.owner.coverArt')}<select value={createArtwork} onChange={(event) => setCreateArtwork(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-4"><option value="">{t('music.album.owner.noCover')}</option>{images.map((image,index)=><option key={image.asset_id} value={image.asset_id}>{t('music.album.owner.libraryImage', { index: index + 1, date: new Date(image.created_at).toLocaleDateString() })}</option>)}</select></label>
      <label className="text-sm font-bold sm:col-span-2">{t('music.album.owner.descriptionLabel')}<textarea value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} maxLength={500} rows={3} className="mt-2 w-full rounded-xl border border-vx-border bg-vx-base px-4 py-3" /></label>
      <p className="text-xs text-vx-fg-muted sm:col-span-2">{t('music.album.owner.artworkHelp')}</p>
      <button disabled={!createTitle.trim() || Boolean(busy)} className="min-h-11 w-fit rounded-full bg-vx-accent px-6 font-bold text-vx-accent-ink disabled:opacity-40">{t(busy === 'create' ? 'music.album.owner.creating' : playlistId ? 'music.album.owner.convert' : 'music.album.owner.create')}</button>
    </form>
    <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_1fr]"><aside aria-label={t('music.album.owner.yourAlbums')} className="space-y-2">{albums.length ? albums.map((album) => <button key={album.id} type="button" aria-pressed={activeId === album.id} onClick={() => setActiveId(album.id)} className={`w-full rounded-xl border p-4 text-left ${activeId === album.id ? 'border-vx-accent bg-vx-accent/10' : 'border-vx-border bg-vx-panel'}`}><strong className="block break-words">{album.title}</strong><span className="mt-1 block text-xs text-vx-fg-muted">{t('music.album.owner.cardMeta', { count: album.tracks.length, status: t(`music.album.status.${album.status}`) })}</span></button>) : <p className="rounded-xl border border-dashed border-vx-border p-4 text-sm text-vx-fg-muted">{t('music.album.owner.first')}</p>}</aside>
      {active ? <section aria-labelledby="album-editor" className="rounded-2xl border border-vx-border bg-vx-panel p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="album-editor" className="font-vx text-2xl font-black">{active.title}</h2><p className="mt-1 text-xs text-vx-fg-muted">{t('music.album.owner.revision', { revision: active.revision, status: t(`music.album.status.${active.status}`) })}</p></div>{active.slug && active.status === 'published' ? <Link href={`/music/albums/${active.slug}`} className="rounded-full border border-vx-border px-4 py-2 text-sm font-bold">{t('music.album.owner.openPublic')}</Link> : null}</div>
        <div className="mt-5 grid gap-3"><label className="text-sm font-bold">{t('music.album.owner.titleLabel')}<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-4" /></label><label className="text-sm font-bold">{t('music.album.owner.releaseType')}<select value={albumType} onChange={(event) => setAlbumType(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-4"><option value="album">{t('music.album.owner.lp')}</option><option value="ep">{t('music.album.ep')}</option><option value="single">{t('music.album.single')}</option></select></label><label className="text-sm font-bold">{t('music.album.owner.coverArt')}<select value={artwork} onChange={(event) => setArtwork(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-4"><option value="">{t('music.album.owner.noCover')}</option>{images.map((image,index)=><option key={image.asset_id} value={image.asset_id}>{t('music.album.owner.libraryImage', { index: index + 1, date: new Date(image.created_at).toLocaleDateString() })}</option>)}</select></label><label className="text-sm font-bold">{t('music.album.owner.descriptionLabel')}<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} className="mt-2 w-full rounded-xl border border-vx-border bg-vx-base px-4 py-3" /></label><button type="button" disabled={Boolean(busy) || !title.trim()} onClick={() => patch('update', { title: title.trim(), album_type: albumType, description: description.trim(), artwork_asset_id: artwork || null })} className="min-h-11 w-fit rounded-full border border-vx-border px-5 font-bold">{t('music.album.owner.saveDetails')}</button></div>
        <fieldset className="mt-7 rounded-xl border border-vx-border p-4"><legend className="px-2 font-vx text-xl font-black">{t('music.album.owner.publishedSongs')}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{trackOptions.map((track) => <label key={track.publication_id} className="flex min-h-11 items-center gap-3 rounded-xl bg-vx-base px-3"><input type="checkbox" checked={selectedTracks.includes(track.publication_id)} onChange={() => toggleTrack(track.publication_id)} disabled={Boolean(busy)} /><span className="break-words text-sm font-bold">{track.title}</span></label>)}</div><button type="button" disabled={Boolean(busy)} onClick={() => patch('replace', { publication_ids: selectedTracks })} className="mt-4 min-h-11 rounded-full border border-vx-border px-5 font-bold">{t('music.album.owner.saveTracks')}</button></fieldset>
        <h3 className="mt-7 font-vx text-xl font-black">{t('music.album.owner.trackOrder')}</h3>{active.tracks.length ? <ol className="mt-3 space-y-3">{active.tracks.map((track, index) => <li key={track.publication_id} className="rounded-xl border border-vx-border bg-vx-base p-4"><div className="flex flex-wrap items-center justify-between gap-3"><strong>{index + 1}. {track.title}</strong><div className="flex gap-2"><button type="button" disabled={Boolean(busy) || index === 0} onClick={() => move(index, -1)} className="min-h-10 rounded-full border border-vx-border px-3 text-sm font-bold disabled:opacity-40">{t('music.album.owner.moveUp')}</button><button type="button" disabled={Boolean(busy) || index === active.tracks.length - 1} onClick={() => move(index, 1)} className="min-h-10 rounded-full border border-vx-border px-3 text-sm font-bold disabled:opacity-40">{t('music.album.owner.moveDown')}</button></div></div><MusicPrivateAudio controls preload="none" src={`/api/music/public/${track.slug}/asset`} className="mt-3 w-full" /></li>)}</ol> : <p className="mt-3 rounded-xl border border-dashed border-vx-border p-4 text-sm text-vx-fg-muted">{t('music.album.owner.emptyTracks')}</p>}
        <div className="mt-7 flex flex-wrap gap-2">{active.status === 'blocked' ? <p role="status" className="rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{t('music.album.owner.takenDown')}</p> : active.status === 'published' ? <button type="button" disabled={Boolean(busy)} onClick={() => patch('unpublish')} className="min-h-11 rounded-full border border-vx-border px-5 font-bold">{t('music.album.owner.unpublish')}</button> : <button type="button" disabled={Boolean(busy) || !active.tracks.length} onClick={() => patch('publish')} className="min-h-11 rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{t('music.album.owner.publish')}</button>}<button type="button" disabled={Boolean(busy)} onClick={() => patch('delete')} className="min-h-11 rounded-full border border-vx-danger/50 px-5 font-bold text-vx-danger disabled:opacity-40">{t('music.album.owner.delete')}</button></div>
      </section> : <section className="rounded-2xl border border-dashed border-vx-border p-8"><h2 className="font-vx text-2xl font-black">{t('music.album.owner.choose')}</h2></section>}</div>
  </div>;
}
