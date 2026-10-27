import { t } from './i18n';
import labels0 from './i18n/messages/en/optionLabels0';
import labels1 from './i18n/messages/en/optionLabels1';
// Never call this for account/user text; only the fixed option sets listed in ADR-0268.
const keys = new Map(Object.entries({ ...labels0, ...labels1 }).map(([key, value]) => [value as string, key]));
export const displayLabel = (value: string): string => { const key = keys.get(value); return key ? t(key) : value; };
