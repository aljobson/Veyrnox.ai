'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useSwapScene } from '../_lib/useSwapScene';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function Lookup({ onChange, accountEpoch }) {
  const { id, scene, loading } = useSwapScene(accountEpoch);
  useEffect(() => { onChange({ id, scene, loading }); }, [onChange, id, scene, loading]);
  return null;
}

export function SwapSceneEntry(props) {
  // Keep ordinary Create's server render intact; query lookup has its own boundary.
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return mounted ? <Lookup {...props} /> : null;
}
