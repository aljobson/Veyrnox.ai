import test from 'node:test';
import assert from 'node:assert/strict';
import { dockClearance, mobileClearance, mobileDockPosition } from '../lib/veyMobileLayout.js';
import { VEY_CHAT_STYLE } from '../lib/veyChatLayout.js';
import { handForPoint, VEY_SIZE } from '../lib/veyPointer.js';
const rect = (left, top, width, height) => ({left, top, right:left+width, bottom:top+height});

test('mobile dock clearance includes the mascot and remains independent of the pointed target', () => {
  const v = {width:390,height:844};
  assert.equal(mobileClearance(32,v,rect(8,674,330,162)),252);
  assert.equal(mobileClearance(32,v,rect(8,480,330,356)),446);
  assert.equal(mobileClearance(32,v,null),32);
  assert.equal(mobileClearance(32,{width:640,height:844},rect(8,674,330,162)),32);
});
test('compact chat uses one shared bounded height and reserves desktop bottom space too', () => {
  assert.equal(VEY_CHAT_STYLE['--vey-chat-height'],'clamp(164px,24dvh,200px)');
  assert.equal(dockClearance(32,{width:1440,height:900},rect(8,692,280,200)),290);
  assert.equal(dockClearance(32,{width:1440,height:900},null),32);
  const guide=rect(8,560,280,124),chat=rect(8,692,280,200),v={width:1440,height:900};
  const dock=mobileDockPosition(v,chat,true);
  assert.ok(dock.x>=chat.right+8);
  assert.ok(dock.y+VEY_SIZE.height<=chat.bottom);
  assert.ok(guide.bottom<chat.top);
});
test('mobile walkthrough reserves a separate mascot lane and never uses scrolled page geometry', () => {
  for (const width of [320,390,430]) {
    const v = {width,height:844};
    const guide=rect(8,650,Math.min(330,width-80),186);
    const dock=mobileDockPosition(v,guide,true);
    assert.ok(dock.x>=guide.right+8);
    assert.ok(dock.x+VEY_SIZE.width<=width-8);
    assert.ok(dock.y>=guide.top&&dock.y+VEY_SIZE.height<=guide.bottom);
    for(let scroll=0;scroll<4000;scroll+=40) {
      // Moving controls cannot enter the docking algorithm or change its result.
      assert.deepEqual(mobileDockPosition(v,guide,true),dock);
    }
  }
});
test('question panel docks Vey above its left edge, clear of the right-hand Resume button', () => {
  assert.deepEqual(mobileDockPosition({width:390,height:844},rect(8,556,330,280)),{x:20,y:490});
  assert.deepEqual(mobileDockPosition({width:320,height:568},rect(8,340,304,220)),{x:20,y:274});
  assert.deepEqual(mobileDockPosition({width:390,height:844},null),{x:8,y:774});
});
test('a visible walkthrough above chat keeps its mascot lane and clears both panels', () => {
  for (const [width,height,chatHeight] of [[390,844,280],[320,568,220]]) {
    const viewport={width,height};
    const chat=rect(8,height-8-chatHeight,Math.min(330,width-16),chatHeight);
    const guide=rect(8,chat.top-8-136,Math.min(330,width-80),136);
    const dock=mobileDockPosition(viewport,guide,true);
    assert.ok(guide.bottom<chat.top);
    assert.ok(dock.x>=guide.right+8);
    assert.ok(dock.y+VEY_SIZE.height<chat.top);
    assert.ok(mobileClearance(32,viewport,guide)>chatHeight+136);
  }
});
test('an avoided body still points with the actual mirrored fingertip', () => {
  const p={x:300,y:200},point={x:54,y:340};
  for (const facing of [-1,1]) {
    const h=handForPoint(p,facing,point), scale=58/170, inset=(56-160*scale)/2;
    assert.ok(Math.abs(p.x+(facing===1?inset+h.x*scale:56-inset-h.x*scale)-point.x)<0.001);
    assert.ok(Math.abs(p.y+h.y*scale-point.y)<0.001);
  }
});

test('mobile movement is explicit and the layout never searches page obstacles on scroll', async () => {
  const { readFile } = await import('node:fs/promises');
  const root = new URL('../', import.meta.url);
  const layout = await readFile(new URL('app/veyrnox/_lib/useVeyMobileLayout.js',root),'utf8');
  const assistant = await readFile(new URL('app/veyrnox/_components/MascotAssistant.jsx',root),'utf8');
  const guide = await readFile(new URL('app/veyrnox/_components/VeyTaskGuide.jsx',root),'utf8');
  assert.doesNotMatch(layout,/addEventListener\('scroll'|safeMobilePosition|querySelectorAll/);
  assert.match(layout,/cue\.current\.position = pointerPlacement/);
  assert.match(layout,/cue\.current = null; refresh\.current\?\.\(\); \}, 2600/);
  assert.match(assistant,/window\.innerWidth < 640 && !options\.explicit/);
  assert.match(guide,/explicit: true, modelKind/);
  assert.match(layout,/root\.style\.scrollPaddingBottom = appliedScrollPadding/);
  assert.match(assistant,/style=\{VEY_CHAT_STYLE\}/);
  assert.match(guide,/style=\{VEY_CHAT_STYLE\}/);
  assert.match(guide,/var\(--vey-chat-height\)/);
  assert.match(assistant,/w-\[min\(280px,calc\(100vw-80px\)\)\]/);
  assert.doesNotMatch(assistant,/sm:h-auto|sm:w-\[min\(410px/);
  assert.match(assistant,/rows=\{1\}/);
  assert.match(guide,/max-h-\[76px\]/);
  assert.match(guide,/w-\[min\(280px,calc\(100vw-80px\)\)\]/);
  assert.match(layout,/position: 'fixed', top: '64px'/);
  assert.match(layout,/viewport\.height - dock\.top \+ 8/);
  assert.match(layout,/overflowY: 'auto'/);
  assert.match(layout,/else restoreWorkspace\(\)/);
});
