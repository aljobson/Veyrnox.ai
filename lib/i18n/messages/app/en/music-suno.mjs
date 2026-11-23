const messages = {
  'app.music.suno.title': 'Title',
  'app.music.suno.lyrics': 'Lyrics',
  'app.music.suno.selectStyles': 'Select styles',
  'app.music.suno.clear': 'Clear',
  'app.music.suno.style': 'Style',
  'app.music.suno.exclude': 'Exclude styles',
  'app.music.suno.excludeNote': 'Only the first {count} characters are applied.',
  'app.music.suno.model': 'Model',
  'app.music.suno.vocalGender': 'Vocal gender',
  'app.music.suno.gender.auto': 'Auto',
  'app.music.suno.gender.male': 'Male',
  'app.music.suno.gender.female': 'Female',
  'app.music.suno.styleWeight': 'Style weight',
  'app.music.suno.weirdness': 'Weirdness constraint',
  'app.music.suno.duration': 'Duration',
  'app.music.suno.seconds': 'seconds',
  'app.music.suno.variety': 'Variety',
  'app.music.suno.variety.0': 'Off',
  'app.music.suno.variety.1': 'Normal',
  'app.music.suno.variety.2': 'High',
  'app.music.suno.variety.3': 'Extra',
  'app.music.suno.variety.4': 'Max',
  'app.music.suno.rights': 'I wrote these lyrics or have permission to use them.',
  'app.music.suno.offer': 'Music offer',
  'app.music.suno.custom': 'Custom',
  'app.music.suno.instrumental': 'Instrumental',
  'app.music.suno.controls': 'Song controls',
  'app.music.suno.brief': 'Song brief',
  'app.music.suno.briefPlaceholder': 'Describe the song, mood and story…',
  'app.music.suno.quoting': 'Reviewing…',
  'app.music.suno.sending': 'Sending…',
  'app.music.suno.reviewPrice': 'Review price',
  'app.music.suno.canvasTitle': 'Create a song pair',
  'app.music.suno.canvasHelp': 'Write a song brief, review the exact server quote, then compare versions A and B here.',
  'app.music.suno.generatingPair': 'Creating two versions…',
  'app.music.suno.pairReady': 'Your song pair',
  'app.music.suno.editUnavailable': 'Some editing tools are hidden because this audio format or file size is not supported for those operations.',
  'app.music.suno.style.cinematic': 'Cinematic',
  'app.music.suno.style.electronic': 'Electronic',
  'app.music.suno.style.indie': 'Indie',
  'app.music.suno.style.jazz': 'Jazz',
  'app.music.suno.style.pop': 'Pop',
  'app.music.suno.style.rock': 'Rock',
  'app.music.suno.contract_refreshed': 'Music controls changed. The current contract and draft were refreshed; review your fields before continuing.',
  'app.music.suno.savingDraft': 'Saving private draft…',
  'app.music.suno.savedRevision': 'Saved privately · revision {count}',
  'app.music.suno.draftConflict': 'A newer draft exists. Resolve it before generating.',
  'app.music.suno.changesSave': 'Changes save privately before the quote.',
  'app.music.suno.useServer': 'Use server version',
  'app.music.suno.keepMine': 'Keep my version',
  'app.music.suno.loadingPolicy': 'Loading Music controls…',
  'app.music.suno.retry': 'Retry',
  'app.music.suno.loadingDraft': 'Loading your private draft…',
  'app.music.suno.stylePlaceholder': 'Describe the musical style…',
  'app.music.suno.version': 'Version {label}',
  'app.music.suno.privateDraft': 'Private draft {label}',
  'app.music.suno.state.queued': 'Queued',
  'app.music.suno.state.running': 'Generating',
  'app.music.suno.state.ready': 'Ready',
  'app.music.suno.state.failed': 'Failed',
  'app.music.suno.state.refunded': 'Refunded',
  'app.music.suno.versionStatus': 'Version {label} is {status}',
  'app.music.suno.candidateIndependent': 'This candidate completes independently from the other version.',
  'app.music.suno.playVersion': 'Play version {label}',
  'app.music.suno.candidateRefunded': 'This version did not complete and its candidate charge was returned.',
  'app.music.suno.candidateFailed': 'This version did not complete. Check your balance before retrying.'
  ,'app.music.suno.credits.one': '{count} Credit'
  ,'app.music.suno.credits.other': '{count} Credits'
  ,'app.music.suno.sendWithCredits': 'Send · {credits}'
  ,'app.music.suno.err.contract_stale': 'Music controls changed. The current contract and draft were refreshed; review the form and request a new quote.'
  ,'app.music.suno.err.contract_refresh_failed': 'Music controls changed, but the refreshed draft could not be loaded. Your text remains on this page.'
  ,'app.music.suno.err.draft_load_failed': 'The private draft could not be loaded. Retry before editing.'
  ,'app.music.suno.err.revision_conflict': 'Your song or Custom draft changed. Close and reopen Reuse before replacing any fields.'
  ,'app.music.suno.err.reuse_unavailable': 'This version has no reusable lyrics or style direction.'
  ,'app.music.suno.err.model_unavailable': 'The verified Custom draft target is currently unavailable.'
  ,'app.music.suno.err.reuse_contract_refreshed': 'Music controls changed. Reuse was refreshed; review the source and try again.'
  ,'app.music.suno.err.reuse_failed': 'The reusable material could not be loaded or applied. Your existing Custom draft is unchanged.'
  ,'app.music.suno.err.unknown': 'Music is temporarily unavailable. No new request was confirmed.'
  ,'app.music.suno.hint.plan_required': 'Custom song generation requires an active paid plan.'
  ,'app.music.suno.hint.style_required': 'Add a style direction before reviewing the price.'
  ,'app.music.suno.hint.lyrics_required': 'Add lyrics or choose Instrumental before reviewing the price.'
  ,'app.music.suno.hint.rights_required': 'Confirm that you wrote these lyrics or have permission to use them.'
  ,'app.music.suno.hint.concurrency_limit': 'All shared Music slots are active. You can keep editing while a pair finishes.'
  ,'app.music.suno.draft_refreshed': 'The active draft was refreshed unchanged. Your previous text was kept separately.'
  ,'app.music.suno.copyPreviousText': 'Copy previous text into this draft'
  ,'app.music.suno.err.draft_stale': 'The active draft changed. It was refreshed unchanged; review it and request a new price.'
};
export default messages;
