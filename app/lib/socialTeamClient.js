'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';
import { getSelectedSocialBrand, setSelectedSocialBrand } from './socialBrandSelection.js';

export function listSocialTeam() {
    const brandId = getSelectedSocialBrand();
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
    setSelectedSocialBrand(result.brand_id);
    return result;
}
