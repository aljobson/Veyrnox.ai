'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const listSocialApiKeys = () => gatewayFetch('/social/developer/keys');
export const createSocialApiKey = (body) => gatewayFetch('/social/developer/keys', { method: 'POST', body: JSON.stringify(body) });
export const revokeSocialApiKey = (id) => gatewayFetch(`/social/developer/keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
