import { stageIssues, promptContext } from './filmStudio.js';
import { FPS, emptyTimeline, addMedia, addVideoClip, setAspect } from './editorTimeline.mjs';
import { checkProbe, mediaFromProbe } from './editorMedia.mjs';
import { timelineSize } from './editorRender.mjs';

export function filmMasterPlan(film, attempt, probe) {
  if (film.stack.aspect !== '16:9') throw new Error('This master export requires a 16:9 film.');
  if (!film.attempts.includes(attempt) || attempt.verdict !== 'accepted') throw new Error('Choose an accepted take.');
  const shot = film.shots.find(s => s.id === attempt.shot);
  const prompt = film.prompts.find(p => p.shot === attempt.shot && p.version === attempt.version);
  if (!shot || !prompt || prompt.context !== promptContext(film, shot) || Array.from({length:7}, (_, i) => stageIssues(film, i)).some(issues => issues.length)) throw new Error('Use a take from the current locked film.');
  const problem = checkProbe(probe);
  if (problem) throw new Error(problem);
  if (probe.kind !== 'video') throw new Error('Choose the video for this take.');
  const frames = Math.round(Number(shot.seconds) * FPS);
  const media = mediaFromProbe('film-take', shot.id, probe);
  const audio = prompt.content.split('\n\n').find(block => block.startsWith('11. Audio\n'))?.slice('11. Audio\n'.length).trim();
  if (/^(silent(?: video)?|no audio)[.!]?$/i.test(audio || '')) media.hasAudio = false;
  if (media.frames < frames) throw new Error('The take is shorter than the shot card.');
  let timeline = addMedia(emptyTimeline(), media);
  timeline = addVideoClip(timeline, media.id, {len:frames});
  if (timeline.error) throw new Error(timeline.error);
  timeline = setAspect(timeline, '16:9');
  return {timeline, size:timelineSize(timeline,1080), seconds:frames / FPS, filename:`${shot.id}-v${attempt.version}-16x9-master.mp4`};
}

export async function exportFilmMaster(file, film, attempt, options) {
  const { probeMedia } = await import('./editorMedia.mjs');
  const { exportTimeline } = await import('./editorExport.mjs');
  const plan = filmMasterPlan(film, attempt, await probeMedia(file));
  const blob = await exportTimeline(plan.timeline, new Map([['film-take',file]]), {...options, height:1080, frameRate:24, format:'mp4', quality:'high', fitMode:'cover'});
  const actual = await probeMedia(blob);
  if (actual.error || actual.width !== 1920 || actual.height !== 1080 || Math.abs(actual.seconds - plan.seconds) > 0.06) throw new Error('The master did not match its required frame or duration.');
  return {blob, filename:plan.filename, width:actual.width, height:actual.height, seconds:plan.seconds};
}
