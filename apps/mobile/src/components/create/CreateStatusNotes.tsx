import { Text } from '../ui';
import { plural, t } from '../../lib/i18n';

/** Under the Generate button: what is still missing, and for video a rough time. */
export function CreateStatusNotes({ need, expectedMinutes }: { need: string | null; expectedMinutes: number }) {
    return <>
        {need ? <Text variant="callout" tone="secondary" accessibilityLiveRegion="polite" testID="create-needs">{need}</Text> : null}
        {expectedMinutes ? <Text variant="caption" tone="tertiary" testID="create-expected">{t('create.expectedVideo', { minutes: String(expectedMinutes) })}</Text> : null}
    </>;
}

// What Generate will cost, said before it is pressed. Free runs left today are applied first.
export function costLine(price: number, n: number, freeLeft: number, unit: number): string {
    if (price === 0) return t('opt.costFree');
    if (n > 1 && freeLeft > 0) return plural('opt.costsPartial', price, { free: String(Math.min(freeLeft, n)), images: String(n) });
    if (n > 1) return plural('opt.costsBatch', price, { images: String(n) });
    return plural('form.costs', unit);
}
