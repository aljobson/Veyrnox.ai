'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const listSocialReportTemplates = () => gatewayFetch('/social/reports');
export const saveSocialReportTemplate = (body) => gatewayFetch('/social/reports', { method: 'PUT', body: JSON.stringify(body) });
export const deleteSocialReportTemplate = (id) => gatewayFetch(`/social/reports?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
