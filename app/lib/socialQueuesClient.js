'use client';
import { gatewayFetch } from '../veyrnox/_lib/gateway.js';
export const listSocialQueues=()=>gatewayFetch('/social/queues');
export const saveSocialQueue=(body)=>gatewayFetch('/social/queues',{method:'PUT',body:JSON.stringify(body)});
export const deleteSocialQueue=(id)=>gatewayFetch(`/social/queues?id=${encodeURIComponent(id)}`,{method:'DELETE'});
export const reserveSocialQueueSlot=(queueId,idempotencyKey)=>gatewayFetch('/social/queues/reserve',{method:'POST',body:JSON.stringify({queueId,idempotencyKey})});
export const confirmSocialQueueSlot=(assignmentId,postId)=>gatewayFetch('/social/queues/reserve',{method:'PATCH',body:JSON.stringify({assignmentId,postId})});
