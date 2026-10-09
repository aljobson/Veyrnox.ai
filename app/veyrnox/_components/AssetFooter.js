'use client';
import { AssetRetention } from './AssetRetention';
import { AskAboutThis } from './AskAboutThis';
import { DownloadAsset } from './DownloadAsset';

/** What sits under a Library card's details: the chat shortcut for an image, Download, then how long the file is kept. */
export function AssetFooter({ row }) {
  return (
    <>
      <AskAboutThis row={row} />
      <DownloadAsset row={row} />
      <AssetRetention row={row} />
    </>
  );
}
