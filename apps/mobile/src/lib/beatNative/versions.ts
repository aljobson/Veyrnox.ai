// @ts-ignore shared JavaScript module
import * as labels from '../../../../../app/veyrnox/_lib/music/beat/beatVersionLabels.mjs';
// @ts-ignore shared JavaScript module
import { restoreVersion as restore } from '../../../../../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { t, getLocale } from '../i18n';
import type { BeatDoc } from './doc';
import { parseCloudBeat } from './rules';
const keys: Record<string, string> = {
    'app.music.beat.shared.today': 'beat.versions.today',
    'app.music.beat.details.d44': 'beat.versions.autosave',
    'app.music.beat.details.d45': 'beat.versions.checkpoint',
    'app.music.beat.recovery.r74': 'beat.versions.conflict',
    'app.music.beat.recovery.r75': 'beat.versions.stash',
};
const sharedLabels = labels as unknown as {
    versionReason(reason: string, translate: (key: string) => string): string;
    versionTime(savedAt: string, now: Date, translate: (key: string) => string, locale: string): string;
};
const translate = (key: string) => t(keys[key] ?? 'beat.versions.unknown');
export const versionReason = (reason: string): string => sharedLabels.versionReason(reason, translate);
export const versionTime = (savedAt: string): string => sharedLabels.versionTime(savedAt, new Date(), translate, getLocale());
export const restoreVersion = restore as (doc: BeatDoc, version: BeatDoc) => BeatDoc;
export const versionEdit = (json: string, id: string) => {
    const doc = parseCloudBeat(json, id);
    return (current: BeatDoc) => restoreVersion(current, doc);
};
