#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Alex DiMarco
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds a Nextcloud Mail version that has no published release yet (the
# Mail 6 pre-releases) from Nextcloud's own source code at one pinned
# commit, with the steps Nextcloud's release build runs (Mail's
# krankerl.toml): composer install --no-dev -o, npm ci, npm run build.
# Nothing in Mail is changed. The result is shaped like a Mail release
# tarball (one "mail" folder), for scripts/integration-test.sh:
#
#   scripts/build-mail.sh 6.0.0-alpha.3 build/mail-6.0.0-alpha.3.tar.gz
#   MAIL_TARBALL=build/mail-6.0.0-alpha.3.tar.gz scripts/integration-test.sh 35 6.0.0-alpha.3
#
# Released Mail versions are not built: the integration test downloads
# them and checks them against a recorded checksum.
#
# Needs: git, PHP 8.2 with Composer 2, Node 24 with npm 11, tar.
set -euo pipefail

usage="usage: scripts/build-mail.sh <mail-version> <out.tar.gz>"
MAIL_VERSION="${1:?$usage}"
OUT="${2:?$usage}"

# The full commit that carries each version in its appinfo/info.xml
case "$MAIL_VERSION" in
	# Mail's main branch on 12 Nov 2026, 11:44 UTC
	6.0.0-alpha.3) MAIL_COMMIT="3780c80a9c6d0a712395929038b612c92ef8970a" ;;
	*) echo "No source commit recorded for Mail $MAIL_VERSION; add it to this script" >&2; exit 2 ;;
esac

mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
src="$work/mail"

echo "== Fetch nextcloud/mail at $MAIL_COMMIT"
git init -q "$src"
git -C "$src" fetch -q --depth 1 https://github.com/nextcloud/mail.git "$MAIL_COMMIT"
git -C "$src" -c advice.detachedHead=false checkout -q FETCH_HEAD
[ "$(git -C "$src" rev-parse HEAD)" = "$MAIL_COMMIT" ] || { echo "fetched the wrong commit" >&2; exit 1; }
version="$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$src/appinfo/info.xml" | head -n 1)"
[ "$version" = "$MAIL_VERSION" ] || { echo "commit $MAIL_COMMIT is Mail $version, not $MAIL_VERSION" >&2; exit 1; }

echo "== Build it as Mail's release build does"
(
	cd "$src"
	composer install --no-dev -o --no-interaction --no-progress
	npm ci --no-audit --no-fund
	npm run build
)

echo "== Pack it like a release"
tar -czf "$OUT" -C "$work" \
	--exclude=mail/.git --exclude=mail/node_modules --exclude=mail/tests --exclude=mail/src \
	mail
echo "Built Mail $MAIL_VERSION from nextcloud/mail@$MAIL_COMMIT: $OUT"
