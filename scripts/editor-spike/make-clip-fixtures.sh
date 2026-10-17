#!/usr/bin/env bash
# Slice C fixtures (ADR-0105): six 5 s shots with a known loudness each, for checking the clip finder. The picture is our own single-shot
# showcase footage; the sound is SYNTHETIC (tones and noise at set levels), because no repo video carries real audio. So this proves the
# loudness pipeline and the ranking logic, not how well the finder suits real speech or music.
# Usage: make-clip-fixtures.sh <output dir>
set -euo pipefail
out="${1:?output dir}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
s="$root/public/showcase"
mkdir -p "$out"
norm="scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1"
i=0
# shot k: gain (0..1) of a 220 Hz tone plus a little noise. Loud shots are 3 (gain 1.0) and 5 (gain 0.5); the rest are quiet.
for spec in "viral-candle-wish-world:0.05" "viral-motorcycle-double:0.05" "viral-architecture-wave:0.9" "viral-tentacle-breakout:0.05" "viral-pearl-earring:0.45" "viral-many-eyed-portrait:0.05"; do
  n=${spec%%:*}; g=${spec##*:}
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$s/$n.mp4" -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=5" -f lavfi -i "anoisesrc=color=pink:amplitude=0.05:sample_rate=48000:duration=5" \
    -t 5 -filter_complex "[0:v]${norm}[v];[1:a]volume=${g}[t];[t][2:a]amix=inputs=2:normalize=0[a]" -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 20 -g 30 -c:a aac -b:a 128k -ar 48000 "$out/.shot$i.mp4"
  i=$((i+1))
done
: > "$out/.list.txt"; for k in 0 1 2 3 4 5; do echo "file '$out/.shot$k.mp4'" >> "$out/.list.txt"; done
ffmpeg -nostdin -hide_banner -loglevel error -y -f concat -safe 0 -i "$out/.list.txt" -c copy "$out/loud-shots.mp4"
rm -f "$out"/.shot*.mp4 "$out/.list.txt"
cat > "$out/truth.json" <<J
{ "loud-shots.mp4": { "cuts": [5, 10, 15, 20, 25], "loudShots": [[10, 15], [20, 25]], "note": "synthetic sound" } }
J
ls -la "$out"
