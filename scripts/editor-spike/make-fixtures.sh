#!/usr/bin/env bash
# Slice 0 fixtures (ADR-0080).  Synthetic clips with a moving white box (frame order), a flat colour (which clip is on screen) and a
# distinct sine tone per clip (which audio is playing). Nothing here is a real person or third-party media.
# Usage: make-fixtures.sh <output dir>
set -euo pipefail
out="${1:?output dir}"
mkdir -p "$out"
fx() { # name colour size seconds tone [extra ffmpeg output args]
  # The white box is an overlay (drawbox evaluates x once, not per frame), so it moves 200 px/s and proves frame order.
  local name=$1 colour=$2 size=$3 secs=$4 tone=$5; shift 5
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=${colour}:s=${size}:r=30:d=${secs}" \
    -f lavfi -i "color=c=white:s=120x120:r=30:d=${secs}" \
    -f lavfi -i "sine=frequency=${tone}:sample_rate=48000:duration=${secs}" \
    -filter_complex "[0:v][1:v]overlay=x='mod(t*200,main_w-140)':y='main_h/2-60':eval=frame[v]" \
    -map "[v]" -map 2:a -shortest "$@" "$out/$name"
}
H264=(-c:v libx264 -pix_fmt yuv420p -g 60 -c:a aac -b:a 128k)
fx a.mp4 0x2060e0 1280x720 4 440 "${H264[@]}"       # blue, 440 Hz
fx b.mp4 0xe02020 1280x720 4 880 "${H264[@]}"       # red, 880 Hz
fx c.mp4 0x20c040 720x1280 2 330 "${H264[@]}"       # green PORTRAIT, 330 Hz
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=10" -c:a pcm_s16le "$out/music.wav"
# 1080p sources for the long scenario
fx h1.mp4 0x2060e0 1920x1080 6 440 "${H264[@]}"
fx h2.mp4 0xe0a020 1920x1080 6 660 "${H264[@]}"
# Compatibility cases
fx h264.mov 0x2060e0 1280x720 2 440 -c:v libx264 -pix_fmt yuv420p -c:a aac
fx vp9.webm 0x2060e0 1280x720 2 440 -c:v libvpx-vp9 -pix_fmt yuv420p -c:a libopus
fx hevc.mp4 0x2060e0 1280x720 2 440 -c:v libx265 -pix_fmt yuv420p -tag:v hvc1 -c:a aac
fx noaudio.mp4 0x2060e0 1280x720 2 440 -c:v libx264 -pix_fmt yuv420p -an
fx opus.mp4 0x2060e0 1280x720 2 440 -c:v libx264 -pix_fmt yuv420p -c:a libopus -strict -2
ls -la "$out" | awk 'NR>1{print $5, $9}'
