export const OUTPUT_FILE_FACTS = Object.freeze([
  {
    label: 'Veyrnox.ai overlay',
    value: 'None added',
    detail: 'Veyrnox.ai does not place its own visible watermark or logo over the provider result.',
  },
  {
    label: 'Provider mark',
    value: 'Not guaranteed absent',
    detail: 'The selected model provider may include its own watermark or identifier. Veyrnox.ai has not inspected this specific file for one.',
  },
  {
    label: 'Embedded credentials',
    value: 'None added by Veyrnox.ai',
    detail: 'Veyrnox.ai does not currently embed C2PA or another content credential in the downloaded media.',
  },
  {
    label: 'Provenance',
    value: 'Not embedded',
    detail: 'Veyrnox.ai does not embed a generation record in the downloaded media file.',
  },
]);

export function outputFileSummary() {
  return 'No Veyrnox.ai overlay · provider marks can vary';
}
