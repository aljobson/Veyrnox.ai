import { t } from '../i18n';
export function exportMessage(code: string) {
    switch (code) {
        case 'download_allowance_exhausted': return t('musicExport.exhausted');
        case 'render_required': return t('musicExport.render');
        case 'quote_expired': return t('musicExport.expired');
        case 'format_unavailable': return t('musicExport.formatUnavailable');
        case 'network': case 'offline': return t('musicExport.offline');
        case 'not_found': return t('musicExport.missing');
        case 'stem_share_failed': return t('musicExport.transfer');
        default: return t('musicExport.error');
    }
}
