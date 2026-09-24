'use client';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { AssetLoadStatus } from './AssetLoadStatus';

export function JobAssetPreview({ job }) {
  const asset = useAssetUrl(job.job_id, job.asset_url);
  return <>
    <AssetLoadStatus asset={asset} />
    {job.mime_type?.startsWith('video/') ? (
      <video src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} controls autoPlay loop playsInline
        className="absolute inset-0 w-full h-full object-contain bg-black" />
    ) : job.mime_type?.startsWith('audio/') ? (
      <div className="absolute inset-0 flex items-center justify-center bg-black px-8">
        <audio src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} controls autoPlay className="w-full max-w-xl" />
      </div>
    ) : (
      <img src={asset.url} onError={asset.onError} onLoad={asset.onLoad} alt="Generated result"
        className="absolute inset-0 w-full h-full object-contain bg-black" />
    )}
  </>;
}
