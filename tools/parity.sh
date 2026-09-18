#!/bin/zsh
# Frame-parity oracle.
#
# Compares two Remotion compositions frame by frame. Its first job was proving that the
# JSON-driven renderer reproduces the hand-written zayavka-v1 composition exactly. Its
# real job is later: when the Swift/AVFoundation renderer exists, it renders the same
# storyboard and gets diffed against these PNGs. That is what makes "deterministic
# renderer" a testable claim instead of an aspiration.
#
# Determinism is asserted on the rendered raster, never on the encoded file. H.264 output
# from VideoToolbox varies across OS versions and hardware encoder generations; frame
# rasters do not.
#
# usage: tools/parity.sh <remotion-project-dir> <compA> <compB> [frames...]

set -u
PROJ=${1:?remotion project dir}
A=${2:?composition A}
B=${3:?composition B}
shift 3
FRAMES=(${@:-40 130 300 500 700 900 1200 1600 2000 2500 3000 3500 4000 4400 4700})

OUT=${TMPDIR:-/tmp}/parity.$$
mkdir -p "$OUT"
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
cd "$PROJ" || exit 1

FAIL=0
echo "--- parity: $A vs $B ---"
for f in $FRAMES; do
  npx remotion still src/index.ts "$A" "$OUT/a$f.png" --frame=$f --browser-executable="$CHROME" --log=error --overwrite >/dev/null 2>&1
  npx remotion still src/index.ts "$B" "$OUT/b$f.png" --frame=$f --browser-executable="$CHROME" --log=error --overwrite >/dev/null 2>&1
  R=$(ffmpeg -v error -i "$OUT/a$f.png" -i "$OUT/b$f.png" -filter_complex "psnr=stats_file=-" -f null - 2>&1 | grep -o "mse_avg:[0-9.]*" | head -1)
  printf "frame %-6s %s\n" "$f" "${R:-COMPARE FAILED}"
  [[ "$R" == "mse_avg:0.00" ]] || FAIL=1
done

echo
if [[ $FAIL -eq 0 ]]; then
  echo "ALL ${#FRAMES} FRAMES PIXEL-IDENTICAL"
else
  echo "differences found. Artefacts kept in $OUT for inspection:"
  echo "  ffmpeg -i $OUT/aNNN.png -i $OUT/bNNN.png -filter_complex 'blend=all_mode=difference,eq=contrast=8' -frames:v 1 diff.png"
fi
exit $FAIL
