'use client';
import { useI18n } from '../../../components/I18nProvider';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { ScheduleGeneration } from './ScheduleGeneration';
import { AssetLoadStatus } from './AssetLoadStatus';
import { CassettePlayer } from './CassettePlayer';

export function JobAssetPreview({ job }) {
  const { t } = useI18n();
  const asset = useAssetUrl(job.job_id, job.asset_url);
  return <>
    <AssetLoadStatus asset={asset} />
    {job.mime_type?.startsWith('video/') ? (
      <video src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} controls autoPlay loop playsInline
        className="absolute inset-0 w-full h-full object-contain bg-black" />
    ) : job.mime_type?.startsWith('audio/') ? (
      <div className="relative flex items-center justify-center bg-black px-8 py-6">
        <CassettePlayer src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} autoPlay label={t("app.library.result")} />
      </div>
    ) : (
      <img src={asset.url} onError={asset.onError} onLoad={asset.onLoad} data-testid="generated-result-image" alt={t("app.library.result")}
        className="absolute inset-0 w-full h-full object-contain bg-black" />
    )}
    <div className="absolute top-3 end-3 z-10"><ScheduleGeneration job={job} /></div>
  </>;
}
