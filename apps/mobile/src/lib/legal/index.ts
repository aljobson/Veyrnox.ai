import structure from './generated/structure';
import { loaders } from './generated/loaders';

export type LegalDoc = keyof typeof structure.documents;
export type LegalBlock = { tag: string; key?: string; attrs?: Record<string, string>; slots?: Record<string, LegalBlock>; children?: LegalBlock[] };
export type LegalLocale = { documents: Record<LegalDoc, Record<string, string>>; chrome: Record<string, string>; jurisdiction: string; tag: string };
export const legalDocs = Object.keys(structure.documents) as LegalDoc[];
export const isLegalDoc = (doc: unknown): doc is LegalDoc => typeof doc === 'string' && legalDocs.includes(doc as LegalDoc);
export function legalData(doc: LegalDoc, language: string) {
    const locale = Object.hasOwn(loaders, language) ? language as keyof typeof loaders : 'en';
    const data: LegalLocale = loaders[locale]();
    return { ...data, ...structure.documents[doc], blocks: structure.documents[doc].blocks as LegalBlock[], messages: data.documents[doc], locale, entity: { ...structure.entity, jurisdiction: data.jurisdiction }, supply: structure.supply };
}
export function isolateNumbers(text: string, locale: string) {
    return locale === 'ar' ? text.replace(/\d+(?:[.,٬:/+-]\d+)*(?:%|\+)?/g, '\u2066$&\u2069') : text;
}
export function legalUpdated(updated: string, locale: string, tag: string) {
    return locale === 'en' ? updated : new Intl.DateTimeFormat(tag, {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC', numberingSystem: 'latn',
    }).format(new Date(`${updated} 00:00:00 GMT`));
}
export function legalLink(href: string, currentDoc?: LegalDoc): { kind: 'legal'; doc: LegalDoc; anchor?: string } | { kind: 'mail'; href: string } | { kind: 'plain'; href: string } {
    // Only our own exact legal paths navigate; external addresses are never executable.
    const match = /^(?:https:\/\/veyrnox\.ai)?\/(?:[a-z]{2}\/)?legal\/([a-z-]+)\/?(?:[?#].*)?$/.exec(href);
    const doc = match && isLegalDoc(match[1]) ? match[1] : href.startsWith('#') ? currentDoc : undefined;
    if (doc) {
        const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
        let anchor = fragment;
        try { anchor = decodeURIComponent(fragment); } catch { /* An invalid fragment simply has no matching id. */ }
        return { kind: 'legal', doc, ...(anchor ? { anchor } : {}) };
    }
    if (/^mailto:[^\s]+$/i.test(href)) return { kind: 'mail', href };
    return { kind: 'plain', href: href.startsWith('//') ? `https:${href}` : href.startsWith('/') ? `https://veyrnox.ai${href}` : href };
}
