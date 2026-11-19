import { t } from '../i18n';
const names: Readonly<Record<string, string>> = {
    source_rights_required: 'rights', format_unavailable: 'format', plan_unavailable: 'plan', model_unavailable: 'model',
    insufficient_balance: 'notAffordable', quote_expired: 'expired', quote_stale: 'expired', quote_already_used: 'expired',
    revision_conflict: 'changed', source_changed: 'changed', consent_declined: 'consent', subscription_required: 'plan',
    crop_range_invalid: 'range', crop_too_short: 'short', concurrency_limit: 'busy', source_unavailable: 'source',
    source_duration_unavailable: 'source', stem_acceptance_unknown: 'recovery', network: 'network',
};
export const actionMessage = (code: string) => t(`musicActions.action.${names[code] ?? 'error'}`);
