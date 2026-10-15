'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';
export const listSocialAutolists = () => gatewayFetch('/social/autolists');
export const saveSocialAutolist = (body) => gatewayFetch('/social/autolists', { method: 'PUT', body: JSON.stringify(body) });
export const deleteSocialAutolist = (id) => gatewayFetch(`/social/autolists?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
