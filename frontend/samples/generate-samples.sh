#!/bin/sh
# Regenerates the demo sample clips (5 s, 1280x720, h264 test patterns).
# The MP4s are not committed to the repo (binary files) — run this once after cloning.
set -e
cd "$(dirname "$0")"
ffmpeg -y -f lavfi -i testsrc2=size=1280x720:rate=30:duration=5 -c:v libx264 -pix_fmt yuv420p -movflags +faststart demo-clinic.mp4
ffmpeg -y -f lavfi -i smptebars=size=1280x720:rate=30:duration=5 -c:v libx264 -pix_fmt yuv420p -movflags +faststart demo-product.mp4
echo "Samples regenerated."
