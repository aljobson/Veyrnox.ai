'use client';
import { useEffect, useRef } from 'react';
import { Mascot } from 'wobnimo/react';
import { wobnimoStateForMood } from '../../../lib/veyCharacterChoice';

const START_TIMEOUT_MS = 5000;

// A wobnimo mascot standing in for Vey's robot. Loaded only through VeyAvatar (next/dynamic, no SSR),
// because it draws with WebGL. The engine can fail after mount (for example a shader that will not link) without
// throwing into React, so a first frame must arrive within START_TIMEOUT_MS or `onFailure` is called.
export default function WobnimoCharacter({ character, pose, reducedMotion, onFailure }) {
  const ready = useRef(false);
  useEffect(() => {
    ready.current = false;
    const timer = setTimeout(() => { if (!ready.current) onFailure?.(); }, START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [character, onFailure]);
  return <Mascot
    character={character}
    state={reducedMotion ? 'idle' : wobnimoStateForMood(pose)}
    interactive={false}
    onReady={() => { ready.current = true; }}
    style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
  />;
}
