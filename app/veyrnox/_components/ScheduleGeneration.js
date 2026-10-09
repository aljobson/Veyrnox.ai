'use client';
import Link from 'next/link';
import { usePublishEnabled } from './PublishFlag';

export function ScheduleGeneration({ job, className = '' }) {
  const enabled = usePublishEnabled();
  if (!enabled || job?.state !== 'succeeded' || !job.asset_url ||
      !/^(image|video)\//.test(job.mime_type || '')) return null;
  return <Link href={`/app/publish?job=${encodeURIComponent(job.job_id)}#schedule`}
    className={`inline-flex rounded-full border border-vx-border bg-vx-panel px-4 py-2 text-sm font-bold hover:border-vx-accent focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent ${className}`}>
    Schedule this
  </Link>;
}
