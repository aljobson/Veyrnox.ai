'use client';
import { AssetRetention } from './AssetRetention';
import { AskAboutThis } from './AskAboutThis';

/** What sits under a Library card's details: the chat shortcut for an image, then how long the file is kept. */
export function AssetFooter({ row }) {
  return (
    <>
      <AskAboutThis row={row} />
      <AssetRetention row={row} />
    </>
  );
}
