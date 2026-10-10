'use client';

import { useRef } from 'react';
import { useClipPlayback } from '../_lib/useClipPlayback';

// A finished clip on a Library card. It used to loop from the moment the page
// loaded, with no way to stop it and whatever the reader's motion setting
// (WCAG 2.2.2). It now follows the landing tiles' policy (_lib/playbackPolicy):
// hover or keyboard focus on the card plays it, touch plays the one on screen
// for at most 5 s, and reduced motion or data-saver leave a still frame.
// `cardRef` is the whole card, so focus on any of its buttons counts.
export function LibraryClip({ cardRef, src, onError, onLoadedData }) {
  const videoRef = useRef(null);
  useClipPlayback(cardRef, videoRef);
  return (
    <video
      ref={videoRef}
      // #t asks for the first frame: without it iOS Safari paints nothing
      // until a clip has played, and most cards here never start.
      src={src ? `${src}#t=0.001` : undefined}
      onError={onError}
      onLoadedData={onLoadedData}
      muted
      loop
      playsInline
      preload="metadata"
      disablePictureInPicture
      disableRemotePlayback
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}
