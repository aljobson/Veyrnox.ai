// Bundled (esbuild, IIFE) into the offline WebView document by prepare-live-edit.mjs. The SAME engine the web Photo Studio
// uses for its live camera, so mobile and web cannot drift. three.js is inlined here for 3D wigs: the page has no URL space.
import { createLiveEngine } from '../../../app/veyrnox/_lib/liveEdit/liveEngine.js';
import { startCamera, stopWhenHidden, cameraErrorCode, listCameras } from '../../../app/veyrnox/_lib/liveEdit/camera.js';
import { createWig3dLayer } from '../../../app/veyrnox/_lib/liveEdit/wig3dLayer.js';
import { headFrame, isWig3d } from '../../../packages/live-edit/wig3d.js';
import * as THREE from '../../../node_modules/three/build/three.module.js';
globalThis.__veyrnoxThree = THREE;
globalThis.VeyrnoxLive = Object.freeze({ createLiveEngine, startCamera, stopWhenHidden, cameraErrorCode, listCameras, createWig3dLayer, headFrame, isWig3d });
