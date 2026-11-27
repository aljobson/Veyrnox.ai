'use client';
import { useState } from 'react';
import BindingText, { BindingPolicyLink } from '../../../../components/BindingText';
import { useI18n } from '../../../../components/I18nProvider';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import PhotoEditor from './PhotoEditor';
import { HardNavigation } from './HardNavigation';
import { control } from './Controls';
export default function PhotoStudio() {
    const { t } = useI18n();
    // A fresh acknowledgement is required on every page visit. This local editor does not
    // upload or record the statement, so it must not reuse the generation-consent store.
    const [rights, setRights] = useState(false), [enabled, setEnabled] = useState(false);
    return <><HardNavigation /><AppNav readAccount={false} /><Main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="mb-2 font-vx-mono text-xs tracking-widest text-vx-accent">{t('app.photoStudio.eyebrow')}</p>
        <h1 className="mb-6 font-vx text-4xl">{t('app.photoStudio.title')}</h1>
        {enabled ? <PhotoEditor /> : <section className="rounded-2xl border border-vx-border p-8">
            <p className="text-sm text-vx-fg-muted">{t('app.photoStudio.intro')}</p>
            <BindingText id="mediaRights" slots={{ policy: <BindingPolicyLink policy="aup" /> }}><label lang="en" dir="ltr" className="mt-5 flex items-start gap-3 text-sm text-vx-fg-muted">
                <input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} className="mt-1 accent-vx-accent" />
                <span>I own these files or have permission to use every identifiable person, voice, brand, artwork, and recording under the <a href="/legal/aup" target="_blank" rel="noreferrer" className="text-vx-accent underline">Acceptable Use Policy</a>.</span>
            </label></BindingText>
            <button className={`${control} mt-5`} disabled={!rights} onClick={() => setEnabled(true)}>{t('app.photoStudio.enable')}</button>
        </section>}
    </Main></>;
}
