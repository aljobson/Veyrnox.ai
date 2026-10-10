'use client';
import Link from 'next/link';

/**
 * Report on a Library card (ADR-0083): a generation that came out wrong goes to
 * a person through /app/account/report. Offered on anything that produced a file.
 */
export function ReportAsset({ row }) {
  if (!row?.job_id || row.state !== 'succeeded') return null;
  return (
    <Link href={`/app/account/report?job=${encodeURIComponent(row.job_id)}`} className="mx-4 mb-3 inline-block text-xs font-semibold text-vx-fg-muted hover:underline">
      Report
    </Link>
  );
}
