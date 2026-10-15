'use client';

import { gatewayFetch } from '../veyrnox/_lib/gateway.js';
export { getSelectedSocialBrand, setSelectedSocialBrand } from './socialBrandSelection.js';

export const listSocialBrands = () => gatewayFetch('/social/brands');
