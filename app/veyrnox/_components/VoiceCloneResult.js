'use client';
import { useEffect } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { useStudioJobs } from '../_lib/useStudioJobs';
import { JobAssetPreview } from './JobAssetPreview';
import { failedJobCopy } from '../_lib/createErrors';

export function VoiceCloneResult({ jobId }) {
  const { t } = useI18n();
  const { jobs, startJobs } = useStudioJobs({});
  useEffect(() => { startJobs({ job_id: jobId, state: 'queued' }); }, [jobId, startJobs]);
  const job = jobs[0];
  return <div className="relative mt-4 overflow-hidden rounded-xl border border-vx-border">
    {job?.state === 'succeeded' ? <JobAssetPreview job={job} /> : <p role="status" className="p-4">{job?.state === 'failed' ? failedJobCopy(job) : t('app.voiceClone.working')}</p>}
  </div>;
}
