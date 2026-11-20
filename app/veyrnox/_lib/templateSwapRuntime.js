'use client';
import { getSession, onSessionChange } from '../../lib/authClient.js';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from './gateway.js';
import { uploadSourceFile } from './uploadSourceFile.js';
import { processSwapPhoto } from './templateSwapPhoto.mjs';
import { createSwapStore } from './templateSwapStore.mjs';
import { createSwapActions } from './templateSwapActions.mjs';
export const swapStore = createSwapStore();
export const swapActions = createSwapActions(swapStore, { makeKey: makeIdempotencyKey, processPhoto: processSwapPhoto, upload: uploadSourceFile, gateway: gatewayFetch, balanceChanged: notifyBalanceChanged,
  refreshOffer: id => window.dispatchEvent(new CustomEvent('veyrnox:template-swap-refresh', { detail: { id } })) });
let connected = false;
export function connectSwapSession() {
  if (connected) return;
  connected = true;
  swapStore.session(getSession()?.user?.id || null);
  onSessionChange((session, event) => swapStore.session(session?.user?.id || null, event?.reason));
}
