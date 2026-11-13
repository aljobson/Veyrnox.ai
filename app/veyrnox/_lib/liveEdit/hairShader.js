export const HAIR_GLSL = `
uniform sampler2D hairMask;
uniform vec3 hairColor; uniform vec3 hairSecond;
uniform vec4 hairParams; // strength, mode, mask top, mask span
vec3 hairLinear(vec3 v) { return mix(v/12.92,pow((v+.055)/1.055,vec3(2.4)),step(vec3(.04045),v)); }
vec3 hairSrgb(vec3 v) { return mix(v*12.92,1.055*pow(max(v,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),v)); }
vec3 applyHair(vec3 color) {
 float alpha=smoothstep(.2,.8,texture(hairMask,uv).r)*hairParams.x;
 if(alpha<=0.) return color;
 vec3 weights=vec3(.2126,.7152,.0722), base=hairLinear(clamp(color,0.,1.));
 float y=dot(base,weights);
 float gradient=hairParams.y==1. ? smoothstep(.25,.85,(uv.y-hairParams.z)/hairParams.w) : 0.;
 vec3 pigment=mix(hairLinear(hairColor),hairLinear(hairSecond),gradient);
 vec3 chroma=pigment-vec3(dot(pigment,weights));
 float gamut=1.;
 for(int i=0;i<3;i++) {
   if(chroma[i]>0.) gamut=min(gamut,(1.-y)/chroma[i]);
   else if(chroma[i]<0.) gamut=min(gamut,-y/chroma[i]);
 }
 if(hairParams.y==2.) alpha*=smoothstep(.08,.55,y);
 return hairSrgb(mix(base,vec3(y)+chroma*gamut,alpha));
}`;
