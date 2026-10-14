'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const listSocialApiKeys = () => gatewayFetch('/social/developer/keys');
export const createSocialApiKey = (body) => gatewayFetch('/social/developer/keys', { method: 'POST', body: JSON.stringify(body) });
export const revokeSocialApiKey = (id) => gatewayFetch(`/social/developer/keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
export const listSocialWebhooks = () => gatewayFetch('/social/developer/webhooks');
export const createSocialWebhook = (body) => gatewayFetch('/social/developer/webhooks', { method: 'POST', body: JSON.stringify(body) });
export const revokeSocialWebhook = (id) => gatewayFetch(`/social/developer/webhooks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
export const listSocialApiLogs = (filters = {}) => {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  return gatewayFetch(`/social/developer/logs${query.size ? `?${query}` : ''}`);
};
