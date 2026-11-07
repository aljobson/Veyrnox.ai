export const scenes = ['a', 'b', 'duo', 'quick'].map(id => ({
  id: `fixture-swap-${id}`, name: `Scene ${id}`, category: 'YOUR PHOTO', aspect: '16:9', needs: 'Photo',
  swapOffer: id === 'quick' ? 'swap-quick' : 'swap-recast', people: id === 'duo' ? 2 : 1,
  model: id === 'quick' ? 'Swap · Quick' : 'Swap · Pro', credits: id === 'quick' ? 67 : 134, durationSeconds: 5,
}));
export const manifest = Object.fromEntries(scenes.map(scene => [scene.id, {
  key: `swap-scenes/${scene.id}.mp4`, version: 'v1', seconds: 7, videoSeconds: 7,
  width: 640, height: 360, contentType: 'video/mp4', sha256: 'a'.repeat(64),
}]));
export const catalog = [
  { id: 'swap-recast', name: 'Swap · Pro', provider: 'fal', provider_endpoint: 'fal-ai/minimax-h3-max-recast', credits_5s: 134 },
  { id: 'swap-quick', name: 'Swap · Quick', provider: 'crun', provider_endpoint: 'crun:wan/2-2-animate-replace', credits_5s: 67 },
].map(row => ({ ...row, active: true, gated_flag: false, modality: 'video-to-video' }));
