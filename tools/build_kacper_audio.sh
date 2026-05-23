#!/usr/bin/env bash
# Convert + loudness-normalize WAV recordings in kacper_sounds/ to .ogg files
# in audio/, with filenames matching the sanitization rules used by
# src/tts.js (ą → aq, ę → eq, etc.).
#
# Usage: tools/build_kacper_audio.sh [src_dir]
#   src_dir defaults to kacper_sounds/
#
# Normalization: single-pass EBU R128 loudnorm (target -16 LUFS, true peak
# -1.5 dBTP). Good enough for short syllable clips; produces consistent
# perceived loudness across recordings done in different sessions.

set -euo pipefail

SRC_DIR="${1:-kacper_sounds}"
OUT_DIR="audio"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found in PATH" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# Mirror the sanitization in src/tts.js -> sanitizeFilename().
sanitize() {
  python3 -c '
import sys, unicodedata, re
s = sys.argv[1].lower()
s = s.replace("ą", "aq").replace("ę", "eq")
s = (s.replace("ć", "c").replace("ł", "l").replace("ń", "n")
       .replace("ó", "o").replace("ś", "s").replace("ź", "z").replace("ż", "z"))
s = re.sub(r"\s+", "_", s)
s = re.sub(r"[^a-z0-9_]", "", s)
print(s)
' "$1"
}

count=0
skipped=0
shopt -s nullglob
for src in "$SRC_DIR"/*.wav "$SRC_DIR"/*.WAV; do
  base="$(basename "$src")"
  stem="${base%.*}"
  out_name="$(sanitize "$stem")"
  out="$OUT_DIR/$out_name.ogg"

  if [[ -f "$out" && "$out" -nt "$src" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "→ $base  ⇒  $out"
  ffmpeg -hide_banner -loglevel error -y \
    -i "$src" \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
    -c:a libvorbis -q:a 5 \
    "$out"
  count=$((count + 1))
done

echo "Done. Converted: $count, up-to-date (skipped): $skipped."
