'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';
export const getSocialSmartLink = () => gatewayFetch('/social/smartlink');
export const saveSocialSmartLink = (body) => gatewayFetch('/social/smartlink', { method: 'PUT', body: JSON.stringify(body) });
