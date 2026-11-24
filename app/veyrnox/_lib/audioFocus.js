'use client';

let active = null;

export function claimAudioFocus(id, pause) {
  if (active?.id !== id) active?.pause?.();
  active = { id, pause };
}

export function releaseAudioFocus(id) {
  if (active?.id === id) active = null;
}

export function resetAudioFocusForTests() { active = null; }
