'use client';

export const SOCIAL_BRAND_KEY = 'veyrnox_publish_team_brand';

export function getSelectedSocialBrand() {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(SOCIAL_BRAND_KEY) || '';
}

export function setSelectedSocialBrand(brandId) {
    if (typeof localStorage === 'undefined') return;
    if (brandId) localStorage.setItem(SOCIAL_BRAND_KEY, brandId);
    else localStorage.removeItem(SOCIAL_BRAND_KEY);
}
