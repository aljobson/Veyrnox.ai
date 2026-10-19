'use client';
import { useI18n } from '../../../components/I18nProvider';

export function AssetLoadStatus({ asset }) {
  const { t } = useI18n();
  if (!asset.loading && !asset.error) return null;
  return (
    <div role="status" className="absolute inset-x-2 bottom-2 z-10 rounded-lg bg-vx-panel border border-vx-border px-3 py-2 text-xs text-vx-fg-body">
      {asset.loading ? t("app.library.reload") : <>
        <span>{asset.error}</span>{' '}
        <button type="button" onClick={asset.retry} className="underline font-bold text-vx-fg">{t("app.account.mfa.retry")}</button>
      </>}
    </div>
  );
}
