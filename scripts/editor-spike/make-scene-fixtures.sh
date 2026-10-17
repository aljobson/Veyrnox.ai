#!/usr/bin/env bash
# Slice A fixtures (ADR-0105): clips with exactly known cuts, built from our own committed showcase and film videos.
# Sources are single shots: ffmpeg's scene score stays under 0.07 over the seconds used (an independent check, not this detector).
# Every cut time is exact because the clip is assembled from whole segments. truth.json lists them per clip.
# Weak cases on purpose (ADR-0092): dissolves, flash frames inside one shot, graphics-only footage, a clip with no cut.
# Usage: make-scene-fixtures.sh <output dir>
set -euo pipefail
out="${1:?output dir}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
s="$root/public/showcase"
mkdir -p "$out"
norm="scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1"
H264=(-an -c:v libx264 -preset veryfast -crf 20 -g 30)
seg() { # <source> <seconds> <index>: one normalised segment
  ffmpeg -hide_banner -loglevel error -y -i "$1" -t "$2" -vf "$norm" "${H264[@]}" "$out/.seg$3.mp4"
}
join() { # <output> <segment indexes...>
  local o=$1; shift; local list="$out/.list.txt"; : > "$list"
  for i in "$@"; do echo "file '$out/.seg$i.mp4'" >> "$list"; done
  ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$list" -c copy "$out/$o"
}

# 1 hard cuts every 4 s, 5 shots, cuts at 4 8 12 16
i=0; for n in viral-candle-wish-world viral-motorcycle-double viral-architecture-wave viral-tentacle-breakout viral-pearl-earring; do seg "$s/$n.mp4" 4 $i; i=$((i+1)); done
join hard-4s.mp4 0 1 2 3 4
# 2 fast cuts every 2 s, 8 shots, cuts at 2 4 6 8 10 12 14
i=10; for n in viral-many-eyed-portrait viral-fallen-angel viral-clones viral-moonwalk viral-sticker-peel-reveal viral-toybox-comes-alive viral-lost-in-a-book viral-cyclope; do seg "$s/$n.mp4" 2 $i; i=$((i+1)); done
join hard-2s.mp4 10 11 12 13 14 15 16 17
# 3 dissolves: 4 shots of 4 s with 0.6 s crossfades; the cut centres are 3.7 7.4 11.1
ffmpeg -hide_banner -loglevel error -y \
  -i "$s/viral-melting.mp4" -i "$s/viral-mini-cake-chef.mp4" -i "$s/viral-giant-age-adventure.mp4" -i "$s/viral-burning-man.mp4" \
  -filter_complex "[0:v]trim=0:4,setpts=PTS-STARTPTS,$norm[a];[1:v]trim=0:4,setpts=PTS-STARTPTS,$norm[b];[2:v]trim=0:4,setpts=PTS-STARTPTS,$norm[c];[3:v]trim=0:4,setpts=PTS-STARTPTS,$norm[d];[a][b]xfade=transition=fade:duration=0.6:offset=3.4[ab];[ab][c]xfade=transition=fade:duration=0.6:offset=6.8[abc];[abc][d]xfade=transition=fade:duration=0.6:offset=10.2[v]" \
  -map "[v]" "${H264[@]}" "$out/dissolve.mp4"
# 4 flashes: two real cuts (5 and 10), plus 2-frame white flashes inside shots at 2.5 and 7.5 that are NOT cuts
i=20; for n in viral-blue-depth viral-bullet-time viral-money-flex; do seg "$s/$n.mp4" 5 $i; i=$((i+1)); done
join .flatcuts.mp4 20 21 22
ffmpeg -hide_banner -loglevel error -y -i "$out/.flatcuts.mp4" \
  -vf "drawbox=x=0:y=0:w=iw:h=ih:color=white@1:t=fill:enable='between(t,2.5,2.567)+between(t,7.5,7.567)'" "${H264[@]}" "$out/flash.mp4"
# 5 screen-recording style: flat dark UI with a growing bar and a row of tiles that fill in every second, between two real shots; cuts at 5 and 10
tiles=""; for k in 0 1 2 3 4; do tiles="$tiles,drawbox=x=$((80 + k * 220)):y=300:w=180:h=180:color=0xb0b8c8@1:t=fill:enable='gte(t,$k)',drawbox=x=$((100 + k * 220)):y=340:w=140:h=20:color=0x0b0d12@1:t=fill:enable='gte(t,$k)'"; done
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=0x0b0d12:s=1280x720:r=30:d=5" \
  -vf "drawbox=x=80:y=120:w='40+220*t':h=36:color=0x3ee0c0@1:t=fill,drawbox=x=80:y=220:w=1120:h=2:color=white@0.4:t=fill$tiles,format=yuv420p" "${H264[@]}" "$out/.seg31.mp4"
seg "$s/viral-pearl-earring.mp4" 5 30; seg "$s/viral-candle-wish-world.mp4" 5 32
join screen.mp4 30 31 32
# 6 no cut: one continuous shot
seg "$s/viral-infinite-clones.mp4" 5 40; cp "$out/.seg40.mp4" "$out/single-shot.mp4"
# 7-9 held out: different sources and spacing, added after the detector settings were fixed on clips 1-6 (so they were not used to tune it)
i=50; for n in viral-dont-blow-out-the-pumpkin viral-knights-diary viral-impressionist-muse viral-cutout viral-epic-slap-knockout; do seg "$s/$n.mp4" 3 $i; i=$((i+1)); done
join heldout-3s.mp4 50 51 52 53 54
i=60; for n in viral-underwater-birthday-kingdom viral-dinosaur-birthday-parade viral-monster-dab viral-act-natural viral-fairytale-castle viral-dolphin-surf-ride viral-birthday-news-report viral-blood-moon-dance; do seg "$s/$n.mp4" 1.5 $i; i=$((i+1)); done
join heldout-1s5.mp4 60 61 62 63 64 65 66 67
ffmpeg -hide_banner -loglevel error -y -i "$s/viral-act-natural.mp4" -i "$s/viral-fairytale-castle.mp4" -i "$s/viral-dolphin-surf-ride.mp4" \
  -filter_complex "[0:v]trim=0:4,setpts=PTS-STARTPTS,$norm[a];[1:v]trim=0:4,setpts=PTS-STARTPTS,$norm[b];[2:v]trim=0:4,setpts=PTS-STARTPTS,$norm[c];[a][b]xfade=transition=fade:duration=0.8:offset=3.2[ab];[ab][c]xfade=transition=fade:duration=0.8:offset=6.4[v]" \
  -map "[v]" "${H264[@]}" "$out/heldout-dissolve.mp4"
rm -f "$out"/.seg*.mp4 "$out"/.flatcuts.mp4 "$out/.list.txt"
cat > "$out/truth.json" <<J
{
  "hard-4s.mp4":     { "cuts": [4, 8, 12, 16] },
  "hard-2s.mp4":     { "cuts": [2, 4, 6, 8, 10, 12, 14] },
  "dissolve.mp4":    { "cuts": [3.7, 7.1, 10.5], "weak": "0.6 s crossfades; cut taken as the middle of each fade" },
  "flash.mp4":       { "cuts": [5, 10], "weak": "2-frame white flashes at 2.5 s and 7.5 s are not cuts" },
  "screen.mp4":      { "cuts": [5, 10], "weak": "flat screen-recording style segment with a counter, a growing bar and changing text" },
  "single-shot.mp4": { "cuts": [] },
  "heldout-3s.mp4":  { "cuts": [3, 6, 9, 12], "heldout": true },
  "heldout-1s5.mp4": { "cuts": [1.5, 3, 4.5, 6, 7.5, 9, 10.5], "heldout": true },
  "heldout-dissolve.mp4": { "cuts": [3.6, 6.8], "weak": "0.8 s crossfades; cut taken as the middle of each fade", "heldout": true }
}
J
ls -la "$out"
