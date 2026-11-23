'use client';
import { useEffect } from 'react';
const owners = new Map();
export function useResultPresence(ids) {
  const key = ids.filter(Boolean).join(',');
  useEffect(() => {
    const token = Symbol();
    owners.set(token, key.split(','));
    return () => { owners.delete(token); };
  }, [key]);
}
export function resultIsPresent(id) {
  return [...owners.values()].some(ids => ids.includes(id));
}
