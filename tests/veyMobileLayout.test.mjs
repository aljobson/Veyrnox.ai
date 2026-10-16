import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileClearance, overlapArea, safeMobilePosition } from '../lib/veyMobileLayout.js';
import { handForPoint, VEY_SIZE } from '../lib/veyPointer.js';
const rect = (left, top, width, height) => ({left, top, right:left+width, bottom:top+height});

test('mobile dock clearance includes the mascot and remains independent of the pointed target', () => {
  const v = {width:390,height:844};
  assert.equal(mobileClearance(32,v,rect(8,674,330,162)),252);
  assert.equal(mobileClearance(32,v,rect(8,480,330,356)),446);
  assert.equal(mobileClearance(32,v,null),32);
  assert.equal(mobileClearance(32,{width:640,height:844},rect(8,674,330,162)),32);
});
test('automatic and manual preferences avoid duration, camera, cost, image and dock obstacles', () => {
  for (const width of [320,390,430]) {
    const v = {width,height:844};
    const obstacles = [rect(16,120,width-32,130),rect(32,300,52,44),rect(width-85,410,44,44),rect(16,500,width-32,140),rect(8,674,width-16,162)];
    for(const desired of [{x:40,y:300},{x:width-85,y:410},{x:32,y:550},{x:100,y:700}]) {
      const p = safeMobilePosition(desired,v,obstacles);
      assert.ok(obstacles.every(r=>overlapArea(p,r)===0),JSON.stringify({width,p}));
      assert.ok(p.x>=8&&p.x+VEY_SIZE.width<=width-8);
      assert.ok(p.y>=72&&p.y+VEY_SIZE.height<=836);
    }
  }
});
test('safe manual choices remain stable; desktop placement is unchanged', () => {
  assert.deepEqual(safeMobilePosition({x:300,y:200},{width:390,height:844},[rect(32,210,52,44)]),{x:300,y:200});
  assert.deepEqual(safeMobilePosition({x:100,y:200},{width:1280,height:900},[rect(32,180,600,150)]),{x:100,y:200});
});
test('an avoided body still points with the actual mirrored fingertip', () => {
  const p={x:300,y:200},point={x:54,y:340};
  for (const facing of [-1,1]) {
    const h=handForPoint(p,facing,point), scale=58/170, inset=(56-160*scale)/2;
    assert.ok(Math.abs(p.x+(facing===1?inset+h.x*scale:56-inset-h.x*scale)-point.x)<0.001);
    assert.ok(Math.abs(p.y+h.y*scale-point.y)<0.001);
  }
});
