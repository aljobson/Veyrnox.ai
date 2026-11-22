import { rawText } from './i18n/translate';
import { useEffect, useRef, type ReactNode, isValidElement } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export function announcementText(node: ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(announcementText).join('');
    if (isValidElement<{ children?: ReactNode }>(node)) return announcementText(node.props.children);
    return '';
}
// Deduplicate rendered status text, not renders, timers or object identities.
// Android implements live regions and alerts; iOS needs explicit announcements for both.
// `everywhere`: for a status with no live region or alert on screen, so Android
// would otherwise say nothing (the no-results lines on Home and Library).
export function useAnnouncement(message: string | null | undefined, { onMount = false, everywhere = false, eventKey }: {
    onMount?: boolean; everywhere?: boolean; eventKey?: string | number;
} = {}) {
    const last = useRef<{ message: string | null; eventKey: string | number | undefined }>({
        message: onMount ? null : message?.trim() || null,
        eventKey,
    });
    useEffect(() => {
        const next = message?.trim() || null;
        if (next === last.current.message && eventKey === last.current.eventKey) return;
        last.current = { message: next, eventKey };
        if (next && (everywhere || Platform.OS === 'ios')) AccessibilityInfo.announceForAccessibility(rawText(next));
    }, [message, everywhere, eventKey]);
}
