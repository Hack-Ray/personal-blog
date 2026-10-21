#!/bin/sh
# Usage: serve-out.sh <port>
# Serves out/ under /personal-blog, the path GitHub Pages uses.
root=$(mktemp -d)
ln -s "$(cd "$(dirname "$0")/.." && pwd)/out" "$root/personal-blog"
exec python3 -m http.server "$1" --bind 127.0.0.1 --directory "$root"
