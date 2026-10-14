'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

const BRAND_KEY = 'veyrnox_publish_team_brand';

export function getSelectedTeamBrand() {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(BRAND_KEY) || '';
}

export function setSelectedTeamBrand(brandId) {
    if (typeof localStorage === 'undefined') return;
    if (brandId) localStorage.setItem(BRAND_KEY, brandId);
    else localStorage.removeItem(BRAND_KEY);
}

export function listSocialTeam() {
    const brandId = getSelectedTeamBrand();
    return gatewayFetch(`/social/team${brandId ? `?brand_id=${encodeURIComponent(brandId)}` : ''}`);
}

export const inviteSocialTeamMember = (email, role, brandId) => gatewayFetch('/social/team', {
    method: 'POST', body: JSON.stringify({ email, role, ...(brandId ? { brandId } : {}) }),
});
export const changeSocialTeamMember = (brandId, memberUserId, action, role) => gatewayFetch('/social/team', {
    method: 'PATCH', body: JSON.stringify({ brandId, memberUserId, action, ...(role ? { role } : {}) }),
});
export const revokeSocialTeamInvite = (brandId, inviteId) => gatewayFetch(`/social/team?brand_id=${encodeURIComponent(brandId)}&invite_id=${encodeURIComponent(inviteId)}`, { method: 'DELETE' });
export async function acceptSocialTeamInvite(token) {
    const result = await gatewayFetch('/social/team/accept', { method: 'POST', body: JSON.stringify({ token }) });
    setSelectedTeamBrand(result.brand_id);
    return result;
}
