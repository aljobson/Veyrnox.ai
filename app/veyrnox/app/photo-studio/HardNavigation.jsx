'use client';
import { useEffect } from 'react';
import { installHardNavigation, reloadIfLeft } from '../../_lib/liveEdit/hardNavigation.js';
/** Renders nothing: makes every exit from Photo Studio a full page load so the camera permission cannot follow the visitor. */
export function HardNavigation() {
    useEffect(() => { const dispose = installHardNavigation(); return () => { dispose(); reloadIfLeft(); }; }, []);
    return null;
}
