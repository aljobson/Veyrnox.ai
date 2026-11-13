export const WIG_GLSL = `
uniform sampler2D wigImage;
uniform float wigOpacity;
vec4 applyWig(vec4 base) {
 if(wigOpacity<=0.) return base;
 vec4 wig=texture(wigImage,uv);
 // Hair confidence feathers only partially covered wig-edge pixels, never the source.
 float edge=wig.a*(1.-.18*smoothstep(.2,.8,texture(hairMask,uv).r)*(1.-smoothstep(.1,.9,wig.a)));
 float alpha=edge*wigOpacity;
 if(alpha<=0.) return base;
 vec3 pigment=hairPigment(wig.rgb,hairParams.x);
 float outAlpha=alpha+base.a*(1.-alpha);
 return vec4((pigment*alpha+base.rgb*base.a*(1.-alpha))/max(outAlpha,.000001),outAlpha);
}`;
