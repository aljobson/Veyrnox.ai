'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const listSocialAdCampaigns=()=>gatewayFetch('/social/ads');
export const saveSocialAdCampaign=(body)=>gatewayFetch('/social/ads',{method:'PUT',body:JSON.stringify(body)});
export const deleteSocialAdCampaign=(id)=>gatewayFetch(`/social/ads?id=${encodeURIComponent(id)}`,{method:'DELETE'});
export const listSocialCommerceProducts=()=>gatewayFetch('/social/commerce/products');
export const saveSocialCommerceProduct=(body)=>gatewayFetch('/social/commerce/products',{method:'PUT',body:JSON.stringify(body)});
export const archiveSocialCommerceProduct=(id)=>gatewayFetch(`/social/commerce/products?id=${encodeURIComponent(id)}`,{method:'DELETE'});
