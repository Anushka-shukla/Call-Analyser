#!/usr/bin/env bash
# Usage: ./scripts/check-audio.sh recording1.mp3 recording2.mp3 ...
# Prints the channel count of each recording. 1 = mono, 2 = stereo.
# For stereo files it also saves left.wav and right.wav so you can listen to each side.
set -e
for f in "$@"; do
  ch=$(ffprobe -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 "$f")
  echo "$f: $ch channel(s)"
  if [ "$ch" = "2" ]; then
    base="${f%.*}"
    ffmpeg -loglevel error -y -i "$f" -af "pan=mono|c0=c0" "${base}-left.wav"
    ffmpeg -loglevel error -y -i "$f" -af "pan=mono|c0=c1" "${base}-right.wav"
    echo "  saved ${base}-left.wav and ${base}-right.wav. If each has only one voice, it's true dual-channel."
  fi
done
