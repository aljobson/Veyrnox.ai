// The /guides pages: short how-tos. Every step describes something the
// product does today; numbers that can change (prices, limits) are stated
// only where the app itself states them (FAQ in tokens.js, the upload hints
// in SourcePickers.js). When one of those changes, change it here too.

export const GUIDES = [
  {
    id: 'first-generation',
    title: 'Make your first image or video',
    summary: 'Pick a model, see the price, generate.',
    steps: [
      { title: 'Open the studio', body: 'Go to Create. Sign in or create an account first; new accounts get 10 free credits once the email is confirmed.' },
      { title: 'Pick a model', body: 'The list on the right shows every model with its price in credits. Image, video and audio models all spend from the same balance.' },
      { title: 'Write the prompt', body: 'Describe what you want to see. For a video, say what moves and how the camera moves.' },
      { title: 'Check the cost', body: 'The total is shown above the Generate button before you press it. A 10-second clip costs twice a 5-second one, and choosing more than one image multiplies the price by the count.' },
      { title: 'Generate', body: 'Credits are taken when you press Generate. If the generation fails, they come back to your balance automatically.' },
    ],
    links: [{ label: 'Open the studio', href: '/app/create' }, { label: 'See every price', href: '/pricing' }],
  },
  {
    id: 'templates',
    title: 'Start from a template',
    summary: 'A ready-made prompt, model and aspect ratio in one click.',
    steps: [
      { title: 'Browse the templates', body: 'Filter by category. Each card shows the model it runs on and its price.' },
      { title: 'Open one', body: 'The template page shows the full prompt, the cost and, if the model needs one, what you have to upload.' },
      { title: 'Use it', body: 'Use this template opens the studio with the prompt, model and aspect ratio filled in. Nothing is charged until you press Generate.' },
      { title: 'Make it yours', body: 'Edit the prompt before you generate. The template is a starting point, not a fixed recipe.' },
    ],
    links: [{ label: 'Browse templates', href: '/presets' }],
  },
  {
    id: 'your-own-files',
    title: 'Work on your own image or video',
    summary: 'Upscale, cut out, expand, edit, animate or lip-sync a file you already have.',
    steps: [
      { title: 'Pick a tool', body: 'The Tools page lists every model that starts from your own file, what it needs and what it costs.' },
      { title: 'Add your file', body: 'Images can be PNG, JPEG or WebP up to 20 MB. Video is MP4 up to 100 MB. Speech is MP3 or WAV up to 20 MB.' },
      { title: 'Or reuse a result', body: 'For an image, From library lets you pick one you already generated instead of uploading it again.' },
      { title: 'Confirm you may use it', body: 'Tick the box stating you own the file or have the permission of everyone identifiable in it. The statement is recorded with the generation.' },
      { title: 'Generate', body: 'The price and the refund on failure work exactly as for any other generation.' },
    ],
    links: [{ label: 'See the tools', href: '/tools' }, { label: 'Acceptable Use', href: '/legal/aup' }],
  },
  {
    id: 'library',
    title: 'Find and keep what you made',
    summary: 'Filter, star and download from your Library.',
    steps: [
      { title: 'Open the Library', body: 'Every generation is listed, including failed ones, so you can see what was refunded.' },
      { title: 'Filter', body: 'Filter by status and by type (images, video, audio), and switch between a grid and a list.' },
      { title: 'Star your favourites', body: 'The star on a card adds it to Favourites. Favourites are remembered in the browser you starred them in.' },
      { title: 'Download what you want to keep', body: 'Generated files are not stored forever. Each card says how long its file is kept; download anything you need before then.' },
    ],
    links: [{ label: 'Open the Library', href: '/app/library' }],
  },
  {
    id: 'credits',
    title: 'How credits and refunds work',
    summary: 'One balance, prices up front, automatic refunds.',
    steps: [
      { title: 'One balance for everything', body: 'Images, video, audio and speech all spend the same credits. Every model shows its price before you generate.' },
      { title: 'Free credits', body: 'The 10 sign-up credits are spent first and expire 90 days after they are granted if unused.' },
      { title: 'Buying credits', body: 'Credit packs are bought on the Credits page through Stripe. Purchased credits never expire.' },
      { title: 'When something fails', body: 'If a generation fails, its credits return to your balance automatically. The Library shows the failed generation and its refund.' },
      { title: 'Limits', body: 'An account can start 10 generations per minute. Going over that is refused without charging you.' },
    ],
    links: [{ label: 'Credits and billing', href: '/app/credits' }, { label: 'Refund Policy', href: '/legal/refund' }],
  },
];

export function guideById(id) {
  return GUIDES.find((g) => g.id === id) || null;
}
