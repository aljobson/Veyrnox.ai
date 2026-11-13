// Ordering matches MAKEUP descriptors: foundation, blush, shadow, brows, liner, lashes, lips.
export const MAKEUP_GLSL = `
uniform highp sampler2DArray makeupMask;
uniform float makeupStrength[7];
uniform vec3 makeupColor[7];
uniform vec3 shadowSecond;
uniform int lipFinish;
vec3 softLight(vec3 b,vec3 s){
 vec3 d=mix(sqrt(max(b,vec3(0.))),((16.*b-12.)*b+4.)*b,lessThanEqual(b,vec3(.25)));
 return mix(b-(1.-2.*s)*b*(1.-b),b+(2.*s-1.)*(d-b),greaterThan(s,vec3(.5)));
}
vec3 screenBlend(vec3 b,vec3 s){return b+s-b*s;}
vec3 applyMakeup(vec3 color){
 for(int i=0;i<7;i++){
   if(makeupStrength[i]<=0.) continue;
   vec2 maskValue=texture(makeupMask,vec3(uv,float(i))).rg;
   float a=maskValue.r*makeupStrength[i];
   if(a<=0.) continue;
   vec3 pigment=makeupColor[i];
   if(i==2) pigment=mix(pigment,shadowSecond,maskValue.g);
   vec3 target=color*pigment;
   if(i==0){
     vec3 evenTone=bilateral(source,uv,pixel,color,.35);
     target=softLight(evenTone,pigment);
   }
   if(i==1) target=softLight(color,pigment);
   if(i==6){
     if(lipFinish==0) target=mix(color*pigment,pigment,.65);
     if(lipFinish==1){
       float highlight=pow(max(0.,1.-abs(maskValue.g-.68)/.22),8.)*.55;
       target=screenBlend(mix(color*pigment,pigment,.4),vec3(highlight));
     }
     if(lipFinish==2) target=softLight(color,pigment);
   }
   color=mix(color,target,a);
 }
 return color;
}
`;
