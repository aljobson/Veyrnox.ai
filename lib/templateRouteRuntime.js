// Routing describes the recipe, independently of picker completeness.
// No catalog/provider imports on the SSR/native graph.
export function routeForContract(contract, legacyModelId, referenceCount) {
  const bound = contract?.class === 'bound';
  const slotCount = bound ? contract.slotCount : 0;
  const bindingReady = bound && referenceCount === slotCount;
  return {
    modelId: bound ? contract.modelId : legacyModelId,
    boundModelId: bound ? contract.modelId : null,
    slotCount, bindingReady,
  };
}
