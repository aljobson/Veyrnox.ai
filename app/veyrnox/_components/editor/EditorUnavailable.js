'use client';
import { useSyncExternalStore } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../components/I18nProvider';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient';
import { Main } from '../Main';

const browserActor = () => getStoredUserId() || '';
const serverActor = () => null;

export function EditorUnavailable() {
    const { t } = useI18n();
    const actor = useSyncExternalStore(onSessionChange, browserActor, serverActor);
    // Session display metadata is browser-owned. Never render this explanation
    // in the anonymous server shell; keep the route's noindex metadata.
    if (actor === null) return null;
    if (!actor) notFound();
    return <Main className="mx-auto max-w-xl space-y-4 p-8">
        <h1 className="text-2xl font-bold">{t('app.editor.simple.notAvailable')}</h1>
        <p className="text-vx-fg-muted">{t('app.editor.simple.notAvailableHelp')}</p>
        <Link className="inline-flex min-h-11 items-center text-vx-accent underline focus-visible:outline-2" href="/app/library">{t('label.Library')}</Link>
    </Main>;
}
