'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_VEY_CHARACTER, VEY_CHARACTER_STORAGE, readVeyCharacter, writeVeyCharacter,
} from '../../../lib/veyCharacterChoice';

export default function useVeyCharacter() {
  // Starts on the default so server and first client render match; the saved choice lands after mount.
  const [character, setCharacterState] = useState(DEFAULT_VEY_CHARACTER);
  useEffect(() => {
    try { setCharacterState(readVeyCharacter(window.localStorage)); } catch { /* Storage may be disabled. */ }
    const onStorage = (event) => {
      if (event.key === VEY_CHARACTER_STORAGE) {
        try { setCharacterState(readVeyCharacter(window.localStorage)); } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const setCharacter = useCallback((id) => {
    setCharacterState(id);
    try { writeVeyCharacter(window.localStorage, id); } catch { /* Still works for this visit. */ }
  }, []);
  return { character, setCharacter };
}
