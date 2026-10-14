'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const listSocialPresets = () => gatewayFetch('/social/presets');
export const saveSocialPreset = (body) => gatewayFetch('/social/presets', { method: 'PUT', body: JSON.stringify(body) });
export const deleteSocialPreset = (id) => gatewayFetch(`/social/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
