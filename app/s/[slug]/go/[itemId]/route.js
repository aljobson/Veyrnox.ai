import { NextResponse } from 'next/server';
import { socialSmartLinksEnabled } from '../../../../../lib/social/publishFeature.js';
import { envConfig, rpc } from '../../../../../packages/db/supabase-client.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(_req,{params}){
  if(!socialSmartLinksEnabled()) return new NextResponse(null,{status:404});
  const {slug,itemId}=await params; if(!UUID.test(itemId||'')) return new NextResponse(null,{status:404});
  const cfg=envConfig(); if(!cfg.supabaseUrl||!cfg.serviceRoleKey) return new NextResponse(null,{status:503});
  try{const out=await rpc('record_social_smartlink_click',{p_slug:slug,p_item_id:itemId},cfg);
    if(!out?.ok||!/^https:\/\//.test(out.url||'')) return new NextResponse(null,{status:404});
    return NextResponse.redirect(out.url,302);
  }catch{return new NextResponse(null,{status:502});}
}
