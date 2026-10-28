import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Text, View, Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { ApiClient } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { cloudSaveError, commitUnlink, getActiveCloudLink, getCloudSaveStatus, getOpenedFilm, openCloudFilm, prepareKeepOnPhone, restorePhoneSlot, saveActiveStudioToCloud, type PrepareResult, type CloudSaveError } from '../../lib/filmCloud';
import type { Film } from '../../lib/filmStudio';
import { formatLocale, t } from '../../lib/i18n';
import { colors } from '../../theme';
import { FilmAction } from './FilmPromptOutput';
import { Text as StatusText } from '../ui/Text';

// Closed domains keep every translation key explicit and reviewable.
export const KEEP_PHONE_ERROR_KEYS = {
    unreadable: 'filmOutput.unreadable', notKept: 'filmOutput.notKept',
    changed: 'filmOutput.changed', localConflict: 'filmOutput.localConflict',
} as const;
const SAVE_ERROR_KEYS = {
    tooLarge: 'filmOutput.error.tooLarge', limit: 'filmOutput.error.limit',
    rateLimited: 'filmOutput.error.rateLimited', conflict: 'filmOutput.error.conflict',
    offline: 'filmOutput.error.offline', unavailable: 'filmOutput.error.unavailable',
    removedElsewhere: 'filmOutput.error.removedElsewhere', failed: 'filmOutput.error.failed',
} as const satisfies Record<CloudSaveError['kind'], string>;

export const confirmFilm = (title: string, body: string, label: string): Promise<boolean> => new Promise(resolve => Alert.alert(title, body, [
    { text: t('film.cancel'), style: 'cancel', onPress: () => resolve(false) },
    { text: label, style: 'destructive', onPress: () => resolve(true) },
], { cancelable: true, onDismiss: () => resolve(false) }));
export async function askKeepOnPhone(owner: string, name: string, current: () => boolean): Promise<PrepareResult | { kind: 'cancelled' }> {
    const cancelPrepared = async (prepared: PrepareResult): Promise<{ kind: 'cancelled' }> => {
        if (prepared.kind === 'kept' || prepared.kind === 'memoryOnly') await restorePhoneSlot(prepared);
        return { kind: 'cancelled' };
    };
    let prepared = await prepareKeepOnPhone(owner);
    if (!current()) return cancelPrepared(prepared);
    if (prepared.kind === 'localConflict') {
        const localName = prepared.localName;
        const choice = await new Promise<'replace' | 'keep' | null>(resolve => Alert.alert(t('filmOutput.localConflict', { value1: localName, value2: name }), '', [
            { text: t('filmOutput.keepLocal', { value1: localName }), onPress: () => resolve('keep') },
            { text: t('filmCloud.replaceConfirm'), style: 'destructive', onPress: () => resolve('replace') },
        ], { cancelable: true, onDismiss: () => resolve(null) }));
        if (!choice || !current()) return { kind: 'cancelled' };
        prepared = await prepareKeepOnPhone(owner, choice);
    }
    return current() ? prepared : cancelPrepared(prepared);
}
export function FilmCloudBar({ api, film, flush, snapshot, valid, beginInstall, endInstall, installFilm, onSaved }: {
    api: Pick<ApiClient, 'request'>; film: Film; flush: () => Promise<void>; snapshot: () => Film;
    valid: () => boolean; beginInstall: () => void; endInstall: () => void; installFilm: (film: Film, owner: string | undefined) => void;
    onSaved: () => void;
}) {
    const [busy, setBusy] = useState(false), [error, setError] = useState<CloudSaveError | null>(null), [notice, setNotice] = useState('');
    const operation = useRef(0), running = useRef(false);
    useEffect(() => { const unsub = subscribeCacheUser(() => { operation.current++; running.current = false; setBusy(false); setError(null); setNotice(''); });
        return () => { unsub(); operation.current++; }; }, []);
    const status = getCloudSaveStatus(film);
    const message = status.kind === 'phone' ? t('filmOutput.phone') : status.kind === 'dirty' ? t('filmOutput.dirty') : t('filmOutput.saved', { value1: status.date ? new Date(status.date).toLocaleString(formatLocale()) : '' });
    async function save(asNew = false) {
        if (running.current || !valid()) return;
        const owner = getCacheUser(), token = ++operation.current;
        const current = () => token === operation.current && owner === getCacheUser() && valid();
        running.current = true; setBusy(true); setError(null); setNotice('');
        AccessibilityInfo.announceForAccessibility(t('film.saving'));
        try {
            await flush(); if (!current()) return;
            const id = asNew ? undefined : getActiveCloudLink()?.id;
            try {
                const project = await saveActiveStudioToCloud(api, snapshot(), randomUUID(), { asNew });
                const link = getActiveCloudLink();
                if (current() && (link?.id !== project.id || link.revision !== project.revision)) { setError({ kind: 'failed' }); return; }
            }
            catch (e) { const reason = await cloudSaveError(e, api, id); if (current()) setError(reason); return; }
            if (current()) {
                onSaved();
                const saved = getCloudSaveStatus(snapshot());
                AccessibilityInfo.announceForAccessibility(saved.kind === 'dirty' ? t('filmOutput.dirty') : t('filmOutput.saved', { value1: saved.kind === 'saved' && saved.date ? new Date(saved.date).toLocaleString(formatLocale()) : '' }));
            }
        } catch (e) { if (current()) setNotice((e as Error).message); }
        finally { if (current()) { running.current = false; setBusy(false); } }
    }
    async function openAccount() {
        const owner = getCacheUser(), link = getActiveCloudLink(), token = ++operation.current;
        const current = () => owner === getCacheUser() && token === operation.current;
        if (!link || !valid() || !await confirmFilm(t('filmCloud.replaceTitle', { name: film.name }), t('filmCloud.replaceBody'), t('filmCloud.replaceConfirm')) || !current()) return;
        beginInstall(); setBusy(true); running.current = true;
        const result = await openCloudFilm(api, link.id);
        if (!current()) return;
        if (result.ok) installFilm(result.film, owner);
        else { endInstall(); setNotice(t('filmCloud.unavailable')); }
        running.current = false; setBusy(false); setError(null);
    }
    async function keepRemoved() {
        const owner = getCacheUser(), link = getActiveCloudLink(), token = ++operation.current;
        const current = () => owner === getCacheUser() && token === operation.current && valid();
        if (!owner || !link || running.current) return;
        running.current = true; setBusy(true);
        await flush().catch(() => undefined);
        if (!current()) return;
        const prepared = await askKeepOnPhone(owner, film.name, current);
        if (!current()) return;
        if (prepared.kind === 'kept' || prepared.kind === 'memoryOnly') {
            beginInstall();
            const result = await commitUnlink(link.id, prepared);
            if (result) { installFilm(result.film, owner); setError(null); setNotice(result.memoryOnly ? t('filmOutput.memoryOnly', { value1: result.film.name }) : t('filmOutput.phone')); }
            else endInstall();
        } else if (prepared.kind !== 'cancelled') setNotice(t(KEEP_PHONE_ERROR_KEYS[prepared.kind]));
        running.current = false; setBusy(false);
    }
    return <View style={{ gap: 12 }}>
        {/* Saving and saved are announced in save(); the live region is for Android. */}
        <StatusText variant="inherit" accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined} style={{ color: colors.muted }}>{busy ? t('film.saving') : message}</StatusText>
        {getOpenedFilm() && !getActiveCloudLink() ? <StatusText variant="inherit" accessibilityLiveRegion="polite" style={{ color: colors.muted }}>{t('filmOutput.memoryOnly', { value1: film.name })}</StatusText> : null}
        {notice ? <StatusText variant="inherit" accessibilityLiveRegion="polite" style={{ color: colors.body }}>{notice}</StatusText> : null}
        {error ? <StatusText variant="inherit" accessibilityLiveRegion="polite" style={{ color: colors.muted }}>{t(SAVE_ERROR_KEYS[error.kind], { value1: error.seconds ?? 60 })}</StatusText> : null}
        <FilmAction label={t('film.savetoaccount')} disabled={busy} onPress={() => void save()} />
        {error?.kind === 'conflict' || !getActiveCloudLink() ? <FilmAction label={t('filmOutput.saveNew')} disabled={busy} onPress={() => void save(true)} /> : null}
        {error?.kind === 'conflict' ? <FilmAction label={t('filmOutput.openAccount')} disabled={busy} onPress={() => void openAccount()} /> : null}
        {error?.kind === 'removedElsewhere' ? <FilmAction label={t('filmOutput.keepPhone')} disabled={busy} onPress={() => void keepRemoved()} /> : null}
    </View>;
}
