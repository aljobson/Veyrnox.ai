// Legacy regions have no name field; MIDI clips and audio assets supply labels.
export function searchClips(doc, query) {
  const needle = String(query).trim().toLowerCase();
  if (!needle) return [];
  return doc.tracks.flatMap(track => track.regions.flatMap(region => {
    const asset = doc.assets?.[region.assetId], clip = doc.clips?.[region.clipId];
    const label = region.name || clip?.name || asset?.name || track.name;
    return [region.name, clip?.name, asset?.name, track.name].some(name => name?.toLowerCase().includes(needle))
      ? [{ trackId: track.id, regionId: region.id, label }] : [];
  }));
}
