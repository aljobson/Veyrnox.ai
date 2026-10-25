// PoC: Veyrnox editor timeline (schemaVersion 2) -> Concat API calls.
// `call(method, params)` returns the JSON-RPC result. `files` maps our media id -> path on the render host.
const FPS = 30
const sec = (f) => f / FPS
const ASPECT = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] }

export async function render(call, tl, files, { location, name, output, width, height }) {
  if (tl.schemaVersion !== 2) throw new Error('PoC handles schemaVersion 2')
  const [pw, ph] = ASPECT[tl.aspect] || [1920, 1080]
  const view = await call('project.create', { location, name, video: { width: pw, height: ph, rateNum: FPS, rateDen: 1 } })
  const path = `${location}/${name}`
  const tl0 = view.project.timelines.find((t) => t.id === view.project.activeTimelineId)
  const videoTrack = tl0.tracks[0].id
  const audioTrack = tl0.tracks[1].id
  const conc = {} // our media id -> concat media id
  for (const m of Object.values(tl.media)) conc[m.id] = (await call('media.import', { path, file: files[m.id] })).createdId

  const notes = []
  const apply = (command) => call('edit.apply', { path, command })
  const place = async (mediaId, track, start, inF, lenF, volume) => {
    const mediaFrames = tl.media[mediaId].frames
    const v = await apply({ op: 'addClip', mediaId: conc[mediaId], trackId: track, start: 0, ripple: false })
    const id = v.createdId
    if (inF > 0) await apply({ op: 'trimClip', clipId: id, edge: 'start', delta: sec(inF) })
    const tail = mediaFrames - inF - lenF
    if (tail > 0) await apply({ op: 'trimClip', clipId: id, edge: 'end', delta: -sec(tail) })
    await apply({ op: 'moveClips', moves: [{ clipId: id, start: sec(start), trackId: track }] })
    if (volume !== 1) await apply({ op: 'updateClip', clipId: id, patch: { volume } })
    return id
  }
  let at = 0
  for (const c of tl.video) {
    await place(c.mediaId, videoTrack, at, c.in, c.len, c.volume)
    if (c.transition) notes.push(`transition on ${c.id} not translated`)
    at += c.len
  }
  for (const c of tl.audio) await place(c.mediaId, audioTrack, c.start, c.in, c.len, c.volume)
  for (const t of tl.text) {
    await apply({ op: 'addTextClip', start: sec(t.start), duration: sec(t.len), offsetY: t.y - 0.5,
      style: { content: t.text, fontSize: t.size / 100, fontWeight: 700, color: '#ffffff', strokeWidth: 0, shadow: true } })
  }
  await call('export.run', { path, output, ...(width ? { width, height } : {}) })
  return { path, notes }
}
