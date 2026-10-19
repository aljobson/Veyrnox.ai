'use client';
import { useI18n } from '../../../components/I18nProvider';
import Link from 'next/link';

/**
 * "Ask about this" on a Library image: opens LLM Chat with that image attached (ADR-0068 amendment 2). Offered on images only, because
 * chat reads images. The chat checks the image is the person's own before anything is charged.
 */
export function AskAboutThis({ row }) {
  const { t } = useI18n();
  if (!row?.asset_url || !row.mime_type?.startsWith('image/')) return null;
  return (
    <Link href={`/app/chat?asset=${encodeURIComponent(row.job_id)}`} className="mx-4 mb-3 inline-block text-xs font-semibold text-vx-accent hover:underline">{t("app.library.ask")}</Link>
  );
}
