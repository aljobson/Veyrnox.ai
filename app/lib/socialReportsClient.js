'use client';
import { gatewayDownload, gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const listSocialReportTemplates = () => gatewayFetch('/social/reports');
export const saveSocialReportTemplate = (body) => gatewayFetch('/social/reports', { method: 'PUT', body: JSON.stringify(body) });
export const deleteSocialReportTemplate = (id) => gatewayFetch(`/social/reports?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
export async function downloadSocialReport(id, format) {
  const result = await gatewayDownload(`/social/reports/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`);
  const url = URL.createObjectURL(result.blob);
  try { const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}
