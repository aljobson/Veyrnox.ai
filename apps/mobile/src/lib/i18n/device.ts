import { NativeModules, Platform } from 'react-native';
import { DEFAULT_LOCALE, matchTag, type LocaleCode } from './locales';

// The device's language list without a new native module (expo-localization would need a rebuild): iOS keeps it in
// the settings manager, Android in the i18n constants, and Hermes' Intl is the last resort. Read once at start.

export interface DeviceSources {
    readonly iosLanguages?: readonly string[] | null;
    readonly androidLocale?: string | null;
    readonly intlLocale?: string | null;
}

export function readDeviceSources(): DeviceSources {
    const sources: { iosLanguages?: string[]; androidLocale?: string; intlLocale?: string } = {};
    try {
        if (Platform.OS === 'ios') {
            const s = NativeModules.SettingsManager?.settings as { AppleLanguages?: unknown; AppleLocale?: unknown } | undefined;
            if (Array.isArray(s?.AppleLanguages)) sources.iosLanguages = s.AppleLanguages.filter((x): x is string => typeof x === 'string');
            else if (typeof s?.AppleLocale === 'string') sources.iosLanguages = [s.AppleLocale];
        } else {
            const id = NativeModules.I18nManager?.localeIdentifier;
            if (typeof id === 'string') sources.androidLocale = id;
        }
    } catch {
        // A missing native module only means the next source is used.
    }
    try {
        sources.intlLocale = new Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
        // No Intl: English.
    }
    return sources;
}

// Language tags in preference order, without empties or repeats.
export function deviceLanguageTags(sources: DeviceSources): string[] {
    const all = [...(sources.iosLanguages ?? []), sources.androidLocale, sources.intlLocale];
    const out: string[] = [];
    for (const tag of all) if (typeof tag === 'string' && tag.trim() && !out.includes(tag)) out.push(tag);
    return out;
}

// The first device language that is switched on, else English. A language that ships but is not active reads English.
export function resolveActive(tags: readonly string[], active: readonly LocaleCode[]): LocaleCode {
    for (const tag of tags) {
        const match = matchTag(tag);
        if (match && active.includes(match)) return match;
    }
    return DEFAULT_LOCALE;
}

export type SlotPiece = string | { readonly slot: string };

// Splits a translation at its {slots}, so a screen can put a link or style where the translation places it, in any
// word order. A {name} that is not in `slots` stays as written.
export function splitSlots(text: string, slots: readonly string[]): SlotPiece[] {
    const out: SlotPiece[] = [];
    let last = 0;
    for (const m of text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
        const name = m[1] ?? '';
        if (!slots.includes(name)) continue;
        const at = m.index ?? 0;
        if (at > last) out.push(text.slice(last, at));
        out.push({ slot: name });
        last = at + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.length ? out : [text];
}
