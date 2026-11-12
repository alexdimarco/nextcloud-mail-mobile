#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Alex DiMarco
# SPDX-License-Identifier: AGPL-3.0-only
#
# Puts together the installable app in build/mail_mobile/ and the tarball
# build/mail_mobile-<version>.tar.gz (the file the app store takes).
#
# Before running it:
#   npm ci && npm run build                      (the front end, into js/)
#   composer install --no-dev && composer scope  (the renamed web push library)
# `composer scope` needs the dev tools, so in practice:
#   composer install && composer scope
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

version="$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' appinfo/info.xml | head -n 1)"
if [ ! -f js/mobile-manifest.json ]; then
	echo "js/ is missing: run 'npm ci && npm run build' first" >&2
	exit 1
fi
if [ ! -f vendor-scoped/autoload/autoload.php ]; then
	echo "vendor-scoped/ is missing: run 'composer install && composer scope' first" >&2
	exit 1
fi

out="build/mail_mobile"
rm -rf build
mkdir -p "$out"
cp -R appinfo img js lib templates vendor-scoped LICENSE README.md CHANGELOG.md "$out/"
if [ -d l10n ]; then
	cp -R l10n "$out/"
fi
# Source maps and build notes are not needed on a server
find "$out/js" -name '*.map' -delete

tar -C build -czf "build/mail_mobile-$version.tar.gz" mail_mobile
echo "Built build/mail_mobile-$version.tar.gz"
