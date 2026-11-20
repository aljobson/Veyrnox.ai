// Portrait-space port of the web fragment shader. No browser renderer is imported.
import { puppetPose } from '../../../../../app/veyrnox/_lib/oddlingPuppetRigs.js';
import type { PuppetRig } from './puppetPrepare';
export const PORTRAIT_FIT = 'cover' as const;
export const PUPPET_SKSL = `
uniform shader plate;
uniform shader head;
uniform float2 size;
uniform float2 viewSize;
uniform float2 pivot;
uniform float4 chest;
uniform float4 arm0;
uniform float4 arm1;
uniform float4 lower;
uniform float4 eye0;
uniform float4 eye1;
uniform float3 lid0;
uniform float3 lid1;
uniform float4 pose; // blink, breath, angle, nod
uniform float4 pose2; // arm swing, weight shift, alternating step, torso sway

float3 eyelid(float3 color, float2 point, float4 eye, float3 lid) {
  float2 d = (point - eye.xy) / eye.zw;
  float coverage = (1.0 - smoothstep(1.02, 1.3, length(d))) * pose.x;
  float seamY = 0.12 * d.x * d.x;
  float seam = (1.0 - smoothstep(0.06, 0.19, abs(d.y - seamY)))
    * (1.0 - smoothstep(0.8, 1.0, abs(d.x)));
  return mix(color, mix(lid, lid * 0.42, seam), coverage);
}

half4 main(float2 viewPoint) {
  // Centred cover, identical to the still portrait's contentFit="cover".
  float scale = max(viewSize.x / size.x, viewSize.y / size.y);
  float2 point = (viewPoint - viewSize * 0.5) / scale + size * 0.5;
  float2 localChest = (point - chest.xy) / chest.zw;
  float weight = pow(max(0.0, 1.0 - dot(localChest, localChest)), 2.0);
  // Every warp reaches zero at its body-zone boundary, keeping the backdrop fixed.
  float2 bodyPoint = point - (point - chest.xy) * pose.y * weight;
  bodyPoint -= float2(pose2.w * 12.0, abs(pose2.z) * 5.0) * weight;

  float2 localArm0 = (point - arm0.xy) / arm0.zw;
  float2 localArm1 = (point - arm1.xy) / arm1.zw;
  float armWeight0 = pow(max(0.0, 1.0 - dot(localArm0, localArm0)), 2.0);
  float armWeight1 = pow(max(0.0, 1.0 - dot(localArm1, localArm1)), 2.0);
  float reach0 = 0.45 + 0.55 * smoothstep(-1.0, 1.0, localArm0.y);
  float reach1 = 0.45 + 0.55 * smoothstep(-1.0, 1.0, localArm1.y);
  bodyPoint -= float2(pose2.x * 26.0 * reach0, abs(pose2.x) * 7.0) * armWeight0;
  bodyPoint -= float2(-pose2.x * 26.0 * reach1, abs(pose2.x) * 7.0) * armWeight1;

  float2 localLower = (point - lower.xy) / lower.zw;
  float lowerWeight = pow(max(0.0, 1.0 - dot(localLower, localLower)), 2.0);
  float legSide = smoothstep(-0.18, 0.18, localLower.x) * 2.0 - 1.0;
  bodyPoint -= float2(pose2.y * 14.0, pose2.z * 10.0 * legSide) * lowerWeight;
  float3 color = plate.eval(bodyPoint).rgb;

  float c = cos(pose.z), s = sin(pose.z);
  float neckBlend = smoothstep(0.0, 80.0, pivot.y - point.y);
  float2 delta = point - pivot - float2(0.0, pose.w * neckBlend);
  float2 source = float2(c * delta.x + s * delta.y, -s * delta.x + c * delta.y) + pivot;
  float4 face = head.eval(source);
  float3 faceColor = eyelid(face.rgb / max(face.a, (1.0 / 255.0)), source, eye0, lid0);
  faceColor = eyelid(faceColor, source, eye1, lid1);
  return half4(mix(color, faceColor, face.a), 1.0);
}`;

export function puppetUniforms(rig: PuppetRig, lids: number[][], id: string, seconds: number, viewSize: number[]) {
    const pose = puppetPose(seconds, id, rig)!;
    return {
        size: [1024, 1536], viewSize, pivot: rig.pivot, chest: rig.chest,
        arm0: rig.arms[0], arm1: rig.arms[1], lower: rig.lower,
        eye0: rig.eyes[0], eye1: rig.eyes[1], lid0: lids[0], lid1: lids[1],
        pose: [pose.blink, pose.breath, pose.angle, pose.nod],
        pose2: [pose.armSwing, pose.weightShift, pose.step, pose.torsoSway],
    };
}
