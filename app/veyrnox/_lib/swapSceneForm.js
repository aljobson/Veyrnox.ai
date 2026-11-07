// Only the customer photo slot is exposed or uploaded. The price is one unit.
export function swapSceneModel(model, scene) {
  if (!scene || model?.id !== scene.swapOffer) return model;
  return { ...model, swap: scene.id, credits: scene.credits, durations: [5],
    media: { image: { ...model.media.image, required: true, maxFiles: scene.people } } };
}

// A scene arrival resets the editable draft; no community prompt is carried over.
export function applySwapScene(scene, { setModelId, setGoal, setDuration, setPrompt }) {
  setModelId(scene.swapOffer);
  setGoal('video');
  setDuration('5s');
  setPrompt('');
}
