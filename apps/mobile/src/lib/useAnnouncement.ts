import { useEffect, useRef, type ReactNode, isValidElement } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export function announcementText(node: ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(announcementText).join('');
    if (isValidElement<{ children?: ReactNode }>(node)) return announcementText(node.props.children);
    return '';
}
// Deduplicate rendered status text, not renders, timers or object identities.
// Android already implements live regions. Alerts announce natively on both platforms.
export function useAnnouncement(message: string | null | undefined) {
    const last = useRef<string | null>(message?.trim() || null);
    useEffect(() => {
        const next = message?.trim() || null;
        if (next === last.current) return;
        last.current = next;
        if (next && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(next);
    }, [message]);
}
