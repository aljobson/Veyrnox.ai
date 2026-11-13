'use client';
import { useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import PhotoEditor from './PhotoEditor';
import { control } from './Controls';
const key = 'veyrnox_photo_studio_preview';
const subscribe = listener => { window.addEventListener('storage', listener); return () => window.removeEventListener('storage', listener); };
const snapshot = () => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
export default function PhotoStudio() {
    const { t } = useI18n();
    const [storageFailed, setStorageFailed] = useState(false);
    const enabled = useSyncExternalStore(subscribe, snapshot, () => false);
    return <><AppNav readAccount={false} /><Main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="mb-2 font-vx-mono text-xs tracking-widest text-vx-accent">{t('app.photoStudio.eyebrow')}</p>
        <h1 className="mb-6 font-vx text-4xl">{t('app.photoStudio.title')}</h1>
        {storageFailed && <p role="alert" className="mb-4 text-vx-danger">{t('app.photoStudio.storageUnavailable')}</p>}
        {enabled ? <PhotoEditor /> : <section className="rounded-2xl border border-vx-border p-8"><p className="text-sm text-vx-fg-muted">{t('app.photoStudio.previewHelp')}</p><button className={`${control} mt-4`} onClick={() => { try { localStorage.setItem(key, '1'); window.dispatchEvent(new Event('storage')); } catch { setStorageFailed(true); } }}>{t('app.photoStudio.enable')}</button></section>}
    </Main></>;
}
