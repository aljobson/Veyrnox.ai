'use client';

export function AssetLoadStatus({ asset }) {
  if (!asset.loading && !asset.error) return null;
  return (
    <div role="status" className="absolute inset-x-2 bottom-2 z-10 rounded-lg bg-vx-panel border border-vx-border px-3 py-2 text-xs text-vx-fg-body">
      {asset.loading ? 'Reloading file…' : <>
        <span>{asset.error}</span>{' '}
        <button type="button" onClick={asset.retry} className="underline font-bold text-vx-fg">Retry</button>
      </>}
    </div>
  );
}
