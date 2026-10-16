'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';
// Keep the loaded document, its role and its write on the same brand even when
// the shell selects a brand while token refresh is still in flight.
export const getSocialSmartLink = (snapshot) => gatewayFetch('/social/smartlink', {}, false, snapshot);
export const getSocialSmartLinkAccounts = (snapshot) => gatewayFetch('/social/accounts', {}, false, snapshot);
export const saveSocialSmartLink = (body, snapshot) => gatewayFetch('/social/smartlink', { method: 'PUT', body: JSON.stringify(body) }, false, snapshot);
