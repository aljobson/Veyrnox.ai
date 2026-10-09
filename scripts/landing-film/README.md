# The landing film

`public/film/price-on-the-button.mp4` is fifteen seconds of the product's own
screens: the Generate button with its price, a job, a failed job and its
refund, the credit statement, the price list. It is drawn in code here and
captured frame by frame. Nothing in it comes from a video model.

| File | What it holds |
| --- | --- |
| `film.html` | The stage and the styles (the site's dark theme and paper slip) |
| `prices.js` | Every price the film shows, keyed by catalog id |
| `engine.js` | Springs, easing and small DOM helpers |
| `build.js` | Builds the scene once, and holds the clock (`T`) and positions (`P`) |
| `film.js` | `seek(t)`: every style, as a function of the time |
| `render.mjs` | Captures the frames with Chrome |

## Look at it

Open `film.html` in Chrome. It plays in real time. Add `?t=7.2` to hold one
moment.

## Rules

- Every style is computed from `t` inside `seek(t)`. No CSS transitions, no
  timers, nothing carried from one frame to the next. That is what lets the
  frames be captured in any order.
- It shows what the product does and says what the site says. The copy is the
  landing page's own.
- A job card's picture is an abstract gradient. The film never shows a picture
  as if a model made it. Clips made by a model go in the tiles, from Veyrnox
  itself (`docs/product/showcase-clips.md`).
- The last frame is the first frame, so it loops.

## When a price changes

The prices are baked into the frames. `tests/landingFilm.test.mjs` compares
`prices.js` with the landing page's fallback list (`MODELS` in
`app/veyrnox/_lib/tokens.js`) and fails when they differ. Then:

1. Update `prices.js` from `GET /api/catalog`.
2. Render and encode again (below).
3. Replace the two files in `public/film/`.

## Render

`playwright-core` is not a dependency of this repo. Install it in a scratch
folder and point at it. It drives the Chrome already on the machine.

```bash
mkdir -p /tmp/film && cd /tmp/film && npm init -y && npm i playwright-core
```

```bash
PLAYWRIGHT_CORE=/tmp/film/node_modules/playwright-core/index.mjs \
  node scripts/landing-film/render.mjs --out /tmp/film/frames
```

That writes 900 frames (60 a second) and takes about ten minutes. Where the
film moves fast (`BLUR` in `build.js`), each frame is eight captures averaged
into motion blur; the rest are one sharp capture each. For a few stills
instead: `--at 2.4,7.3,13.9`.

## Encode

The master, 1080p at 60 frames a second:

```bash
ffmpeg -framerate 60 -i /tmp/film/frames/f-%06d.png \
  -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart /tmp/film/master.mp4
```

The landing copy, 720p, no audio track, under `MAX_FILM_BYTES`:

```bash
ffmpeg -i /tmp/film/master.mp4 -an -vf "scale=1280:720:flags=lanczos" -c:v libx264 -crf 27 -preset veryslow \
  -pix_fmt yuv420p -movflags +faststart public/film/price-on-the-button.mp4
```

The poster is the end card, which is the film's one still moment:

```bash
ffmpeg -ss 13.9 -i /tmp/film/master.mp4 -frames:v 1 -vf "scale=1280:720:flags=lanczos" -q:v 4 \
  public/film/price-on-the-button.jpg
```

Then `npm test`.
