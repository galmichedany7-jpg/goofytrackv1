#!/bin/bash
# GoofyTrack launcher for macOS: double-click it (it opens in Terminal) to install, update, rebuild or start the
# game. The menu itself is sources/launcher/menu.js.
cd "$(dirname "$0")" || exit 1
# Node.js installed from nodejs.org or with Homebrew, even when the shell profile does not say so
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
if ! command -v node >/dev/null 2>&1; then
  echo "GoofyTrack a besoin de Node.js (version 18 ou plus récente) : installez-le depuis https://nodejs.org puis relancez."
  open "https://nodejs.org"
  read -r -p "Appuyez sur Entrée pour fermer."
  exit 1
fi
node sources/launcher/menu.js "$@"
