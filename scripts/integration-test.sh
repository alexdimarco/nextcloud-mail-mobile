#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Alex DiMarco
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Starts a throwaway Nextcloud with the Mail app in Docker, and a
# throwaway mail server (Dovecot and Postfix, the image Mail's own tests
# use), installs the built Mail Mobile app, and checks that it works:
#   - the app enables
#   - the phone page answers and loads the current (hashed) bundle
#   - the home-screen manifest is valid JSON with the right scope
#   - the service worker is served with its Service-Worker-Allowed header
#   - the push key route hands out a public key, and occ can reset it
#   - signing out removes the notification subscriptions of that sign-in
#   - the personal and admin settings pages show this app's sections
#   - every Mail web address the phone page calls works against a real
#     mail account (scripts/check-mail-routes.py), and Mail's own page
#     loads this app's sign-in return script
#   - new inbox mail queues a notification job (Mail's event still fires
#     and this app still reads it)
#   - with Mail turned off, the page says plainly that Mail is needed
#
# Usage: scripts/integration-test.sh [nextcloud-major] [mail-version]
#   e.g. scripts/integration-test.sh 33 5.13.2
#        MAIL_TARBALL=build/mail-6.0.0-alpha.3.tar.gz scripts/integration-test.sh 35 6.0.0-alpha.3
# A Mail version with no published release (Mail 6 pre-releases) is built
# from source first with scripts/build-mail.sh and passed as MAIL_TARBALL.
# Needs: Docker, curl, python3, and a finished build (scripts/build-release.sh).
set -euo pipefail

NC_MAJOR="${1:-33}"
MAIL_VERSION="${2:-5.13.2}"
PORT="${PORT:-8089}"

# Images pinned by digest, so a test run is repeatable
case "$NC_MAJOR" in
	33) NC_IMAGE="nextcloud@sha256:81cb09055a20142521a267cea2bc27e6a81a065871c70850d209f08803567dbc" ;; # 33-apache
	34) NC_IMAGE="nextcloud@sha256:d8ad0b77c863611b9fab6e72a82a5d35fbcb218b660f9f20fec9941a50806281" ;; # 34-apache
	35) NC_IMAGE="nextcloud@sha256:786c102155d2717ba0f53a62b3fdd7a1354edc48e800b94dbe32294d9a5752a2" ;; # 35-apache
	*) echo "Unknown Nextcloud version $NC_MAJOR (known: 33, 34, 35)" >&2; exit 2 ;;
esac

# Mail release tarballs, pinned by checksum. Versions without a published
# release come from scripts/build-mail.sh (MAIL_TARBALL), which pins the
# source commit instead.
MAIL_SHA256=""
if [ -z "${MAIL_TARBALL:-}" ]; then
	case "$MAIL_VERSION" in
		5.13.2) MAIL_SHA256="bad5ec351a265916f7fcb048f1f3ceb3994e2bfd95f23e793f854f6cc12c9e58" ;;
		6.0.0-alpha.3) echo "Mail $MAIL_VERSION has no published release: build it with scripts/build-mail.sh and pass MAIL_TARBALL" >&2; exit 2 ;;
		*) echo "No checksum recorded for Mail $MAIL_VERSION; add it to this script" >&2; exit 2 ;;
	esac
fi
MAIL_URL="https://github.com/nextcloud-releases/mail/releases/download/v${MAIL_VERSION}/mail-v${MAIL_VERSION}.tar.gz"

# A throwaway mail server: the image Mail's own integration tests use,
# pinned to the same digest. Its one account is a public test account.
IMAP_IMAGE="ghcr.io/christophwurst/docker-imap-devel@sha256:b76a062268d7342ccec549f5323a0b6dc1b6ac55b03367f474934927653f5cb5"
MAIL_USER="user@domain.tld"
MAIL_PASS="mypassword"
IMAP_PORT="${IMAP_PORT:-3993}"

root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/build/mail_mobile"
if [ ! -f "$app/appinfo/info.xml" ] || [ ! -f "$app/js/mobile-manifest.json" ]; then
	echo "No build found in build/mail_mobile: run scripts/build-release.sh first" >&2
	exit 1
fi

work="$(mktemp -d)"
name="mail-mobile-it-$NC_MAJOR-$$"
password="$(python3 -c 'import secrets; print(secrets.token_hex(12))')"
base="http://localhost:$PORT"

cleanup() {
	status=$?
	if [ "$status" -ne 0 ]; then
		# What the server and the mail server said, to see why
		echo "-- Nextcloud log (last warnings and errors):" >&2
		docker exec "$name" sh -c 'tail -n 400 /var/www/html/data/nextcloud.log 2>/dev/null' \
			| grep -E '"level":[2-4],' | tail -n 8 | cut -c1-1500 >&2 || true
		echo "-- mail server log (last lines):" >&2
		docker logs --tail 15 "$name-mailserver" >&2 2>&1 || true
	fi
	docker rm -f "$name" "$name-mailserver" >/dev/null 2>&1 || true
	docker network rm "$name-net" >/dev/null 2>&1 || true
	rm -rf "$work"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
occ() { docker exec -u www-data "$name" php occ "$@"; }

if [ -n "${MAIL_TARBALL:-}" ]; then
	step "Use Mail $MAIL_VERSION built from source ($MAIL_TARBALL)"
	cp "$MAIL_TARBALL" "$work/mail.tar.gz"
else
	step "Download Mail $MAIL_VERSION"
	curl -fsSL -o "$work/mail.tar.gz" "$MAIL_URL"
	echo "$MAIL_SHA256  $work/mail.tar.gz" | sha256sum -c - 2>/dev/null \
		|| echo "$MAIL_SHA256  $work/mail.tar.gz" | shasum -a 256 -c -
fi
found="$(tar -xzOf "$work/mail.tar.gz" mail/appinfo/info.xml | sed -n 's:.*<version>\(.*\)</version>.*:\1:p' | head -n 1)"
[ "$found" = "$MAIL_VERSION" ] || fail "the Mail tarball is Mail $found, not $MAIL_VERSION"
echo "ok: Mail $found"

step "Start a throwaway mail server"
docker network create "$name-net" >/dev/null
docker run -d --name "$name-mailserver" --network "$name-net" --network-alias mailserver \
	-p "127.0.0.1:$IMAP_PORT:993" \
	-e MAILNAME=mail.domain.tld -e MAIL_ADDRESS="$MAIL_USER" -e MAIL_PASS="$MAIL_PASS" \
	"$IMAP_IMAGE" >/dev/null

step "Start Nextcloud $NC_MAJOR"
docker run -d --name "$name" --network "$name-net" -p "127.0.0.1:$PORT:80" \
	-e SQLITE_DATABASE=nextcloud \
	-e NEXTCLOUD_ADMIN_USER=admin \
	-e NEXTCLOUD_ADMIN_PASSWORD="$password" \
	-e NEXTCLOUD_TRUSTED_DOMAINS=localhost \
	"$NC_IMAGE" >/dev/null

for _ in $(seq 1 120); do
	if occ status --output=json 2>/dev/null | grep -q '"installed":true'; then
		break
	fi
	sleep 3
done
occ status --output=json | grep -q '"installed":true' || fail "Nextcloud did not finish installing"
occ status

step "Install Mail $MAIL_VERSION and Mail Mobile"
docker cp "$work/mail.tar.gz" "$name:/tmp/mail.tar.gz"
docker exec "$name" sh -c 'tar -xzf /tmp/mail.tar.gz -C /var/www/html/custom_apps && chown -R www-data:www-data /var/www/html/custom_apps/mail'
docker cp "$app" "$name:/var/www/html/custom_apps/mail_mobile"
docker exec "$name" chown -R www-data:www-data /var/www/html/custom_apps/mail_mobile
occ app:enable mail
occ app:enable mail_mobile
occ app:list --output=json | python3 -c 'import json,sys; e=json.load(sys.stdin)["enabled"]; print("mail", e.get("mail"), "| mail_mobile", e.get("mail_mobile")); sys.exit(0 if "mail" in e and "mail_mobile" in e else 1)' \
	|| fail "the apps are not both enabled"

step "The phone page answers and loads the hashed bundle"
bundle="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["main"])' "$app/js/mobile-manifest.json")"
status="$(curl -s -o "$work/page.html" -w '%{http_code}' -u "admin:$password" "$base/index.php/apps/mail_mobile/")"
[ "$status" = "200" ] || fail "phone page answered $status"
grep -q "${bundle%.js}" "$work/page.html" || fail "the page does not load $bundle"
grep -q 'id="mail-mobile"' "$work/page.html" || fail "the page has no app container"
echo "ok: 200, loads $bundle"

step "The home-screen manifest is valid, with the right scope"
curl -fsS "$base/index.php/apps/mail_mobile/manifest.webmanifest" -o "$work/manifest.json"
python3 - "$work/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
assert m["display"] == "standalone", m
assert m["scope"].endswith("/apps/mail_mobile/"), m["scope"]
assert m["start_url"] == m["scope"], m
assert {"192x192", "512x512"} <= {i["sizes"] for i in m["icons"]}, m["icons"]
print("ok: scope", m["scope"])
PY

step "The service worker carries its scope header"
curl -fsS -D "$work/sw.headers" -o "$work/sw.js" "$base/index.php/apps/mail_mobile/sw.js"
grep -qi '^service-worker-allowed: .*/apps/mail_mobile/' "$work/sw.headers" || fail "no Service-Worker-Allowed header"
grep -q 'showNotification' "$work/sw.js" || fail "sw.js is not the service worker"
echo "ok"

step "The push key route hands out a public key"
key1="$(curl -fsS -u "admin:$password" "$base/index.php/apps/mail_mobile/push/key" | python3 -c 'import json,sys; print(json.load(sys.stdin)["publicKey"])')"
[ "${#key1}" -ge 80 ] || fail "unexpected public key: $key1"
occ mail_mobile:vapid:reset
# The web server keeps app settings in its memory cache for 3 seconds
sleep 4
key2="$(curl -fsS -u "admin:$password" "$base/index.php/apps/mail_mobile/push/key" | python3 -c 'import json,sys; print(json.load(sys.stdin)["publicKey"])')"
[ "$key1" != "$key2" ] || fail "occ mail_mobile:vapid:reset did not make new keys"
echo "ok: key length ${#key1}, reset works"

step "Subscribing to an address outside the allowlist is refused"
# Like a browser: one session (cookie jar) and its anti-forgery token
jar="$work/cookies"
token="$(curl -fsS -c "$jar" -b "$jar" -u "admin:$password" "$base/index.php/csrftoken" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
status="$(curl -s -o "$work/subscribe.json" -w '%{http_code}' -c "$jar" -b "$jar" -u "admin:$password" \
	-H "requesttoken: $token" -H 'Content-Type: application/json' \
	-d '{"endpoint":"https://169.254.169.254/latest","p256dh":"x","auth":"y"}' "$base/index.php/apps/mail_mobile/push")"
[ "$status" = "400" ] || { cat "$work/subscribe.json" >&2; fail "subscribing to an internal address answered $status"; }
status="$(curl -s -o /dev/null -w '%{http_code}' -c "$jar" -b "$jar" -u "admin:$password" \
	-H 'Content-Type: application/json' \
	-d '{"endpoint":"https://fcm.googleapis.com/fcm/send/x","p256dh":"x","auth":"y"}' "$base/index.php/apps/mail_mobile/push")"
[ "$status" != "200" ] || fail "a subscription without the anti-forgery token was accepted"
echo "ok: 400"

step "Signing out stops the notifications that sign-in turned on"
# A real browser sign-in (form login), so there is a session sign-in to end
login() {
	rm -f "$1"
	local page_token
	page_token="$(curl -fsS -c "$1" -b "$1" "$base/index.php/login" | python3 -c 'import re,sys; print(re.search(r"data-requesttoken=\"([^\"]+)\"", sys.stdin.read()).group(1))')"
	# Nextcloud only accepts a sign-in form sent from its own pages (Origin)
	curl -s -o /dev/null -c "$1" -b "$1" -H "Origin: $base" --data-urlencode "user=admin" --data-urlencode "password=$password" \
		--data-urlencode "requesttoken=$page_token" "$base/index.php/login"
	curl -fsS -c "$1" -b "$1" "$base/index.php/csrftoken" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])'
}
check_subscribed() {
	curl -fsS -c "$1" -b "$1" -H "requesttoken: $2" -H 'Content-Type: application/json' \
		-d '{"endpoint":"https://fcm.googleapis.com/fcm/send/it-test"}' "$base/index.php/apps/mail_mobile/push/check" \
		| python3 -c 'import json,sys; print(json.load(sys.stdin)["subscribed"])'
}
phone="$work/phone-cookies"
phone_token="$(login "$phone")"
status="$(curl -s -o "$work/subscribe.json" -w '%{http_code}' -c "$phone" -b "$phone" \
	-H "requesttoken: $phone_token" -H 'Content-Type: application/json' \
	-d '{"endpoint":"https://fcm.googleapis.com/fcm/send/it-test","p256dh":"x","auth":"y"}' "$base/index.php/apps/mail_mobile/push")"
[ "$status" = "200" ] || { cat "$work/subscribe.json" >&2; fail "subscribing answered $status"; }
[ "$(check_subscribed "$phone" "$phone_token")" = "True" ] || fail "the new subscription is not reported as this user's"
curl -fsS -c "$phone" -b "$phone" "$base/index.php/settings/user/mail_mobile" | grep -q 'Devices that get notifications' \
	|| fail "the personal settings page has no device list"
curl -s -o /dev/null -c "$phone" -b "$phone" "$base/index.php/logout?requesttoken=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$phone_token")"
other="$work/other-cookies"
other_token="$(login "$other")"
[ "$(check_subscribed "$other" "$other_token")" = "False" ] || fail "the subscription outlived signing out"
echo "ok: removed at sign-out"

step "Turning notifications off sends the push address in the body"
off_endpoint="https://fcm.googleapis.com/fcm/send/it-off-$$"
status="$(curl -s -o /dev/null -w '%{http_code}' -c "$other" -b "$other" -H "requesttoken: $other_token" -H 'Content-Type: application/json' \
	-d "{\"endpoint\":\"$off_endpoint\",\"p256dh\":\"x\",\"auth\":\"y\"}" "$base/index.php/apps/mail_mobile/push")"
[ "$status" = "200" ] || fail "subscribing answered $status"
status="$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -c "$other" -b "$other" -H "requesttoken: $other_token" -H 'Content-Type: application/json' \
	-d "{\"endpoint\":\"$off_endpoint\"}" "$base/index.php/apps/mail_mobile/push")"
[ "$status" = "200" ] || fail "turning notifications off answered $status"
still="$(curl -fsS -c "$other" -b "$other" -H "requesttoken: $other_token" -H 'Content-Type: application/json' \
	-d "{\"endpoint\":\"$off_endpoint\"}" "$base/index.php/apps/mail_mobile/push/check" \
	| python3 -c 'import json,sys; print(json.load(sys.stdin)["subscribed"])')"
[ "$still" = "False" ] || fail "the subscription is still there after turning notifications off"
echo "ok: removed, address sent in the body"

step "The admin settings page asks for a push contact address"
curl -fsS -c "$other" -b "$other" "$base/index.php/settings/admin/additional" | grep -q 'mail-mobile-admin' \
	|| fail "no Mail Mobile section in the admin settings"
echo "ok"

step "The Mail addresses the phone page calls exist in this Mail version"
for path in "api/accounts" "api/autoComplete?term=sa"; do
	status="$(curl -s -o "$work/mail-api.json" -w '%{http_code}' -c "$jar" -b "$jar" -u "admin:$password" \
		-H "requesttoken: $token" "$base/index.php/apps/mail/$path")"
	[ "$status" = "200" ] || fail "Mail's /apps/mail/$path answered $status"
	python3 -c 'import json,sys; assert isinstance(json.load(open(sys.argv[1])), list)' "$work/mail-api.json" \
		|| fail "Mail's /apps/mail/$path did not answer with a list"
done
echo "ok: accounts and address search answer"

step "The Mail address checker refuses a server that is not this machine"
# It changes mail and settings, so it must never run against a real server
set +e
refused="$(NC_PASSWORD=unused python3 -I "$root/scripts/check-mail-routes.py" \
	--base https://cloud.example.org --user admin --mail-user "$MAIL_USER" --mail-password "$MAIL_PASS" \
	--imap-port "$IMAP_PORT" --mail-version "$MAIL_VERSION" 2>&1)"
code=$?
set -e
[ "$code" = "2" ] && echo "$refused" | grep -q 'Refusing to run against' \
	|| { echo "$refused" >&2; fail "check-mail-routes.py did not refuse a remote server (exit $code)"; }
echo "ok: refused (exit 2)"

step "Every Mail address the phone page calls works with a real mail account"
for _ in $(seq 1 60); do
	if python3 -c 'import imaplib, ssl, sys; imaplib.IMAP4_SSL("127.0.0.1", int(sys.argv[1]), ssl_context=ssl._create_unverified_context()).logout()' "$IMAP_PORT" 2>/dev/null; then
		break
	fi
	sleep 2
done
# Background jobs only from cron, which is not running here: nothing is
# sent to a push service during the test
occ background:cron
# The throwaway mail server has a self-signed certificate (as in Mail's own tests)
occ config:system:set app.mail.verify-tls-peer --type bool --value false
occ mail:account:create-imap admin "Test account" "$MAIL_USER" \
	mailserver 993 ssl "$MAIL_USER" "$MAIL_PASS" \
	mailserver 25 none "$MAIL_USER" "$MAIL_PASS"
inbox_id="$(NC_PASSWORD="$password" python3 -I "$root/scripts/check-mail-routes.py" \
	--base "$base" --user admin --mail-user "$MAIL_USER" --mail-password "$MAIL_PASS" \
	--imap-port "$IMAP_PORT" --mail-version "$MAIL_VERSION" | tee /dev/stderr | tail -n 1)"
[ -n "$inbox_id" ] || fail "the Mail address checks did not finish"

step "New inbox mail queued a notification job"
# Read straight from the database: the job holds only ids
jobs="$(docker exec -u www-data "$name" php -r '
	$db = new PDO("sqlite:/var/www/html/data/nextcloud.db");
	foreach ($db->query("SELECT argument FROM oc_jobs WHERE class = '"'"'OCA\\MailMobile\\BackgroundJob\\PushJob'"'"'") as $row) {
		echo $row["argument"], "\n";
	}')"
echo "$jobs" | python3 -c '
import json, sys
inbox = int(sys.argv[1])
jobs = [json.loads(line) for line in sys.stdin if line.strip()]
# The message the test sent to itself may arrive in the same sync, so
# one or more new messages; at most 3 ids are kept, never any content
match = [j for j in jobs if j.get("userId") == "admin" and j.get("mailboxId") == inbox and j.get("count", 0) >= 1]
assert match, f"no notification job for the inbox: {jobs}"
assert set(match[0]) == {"userId", "accountId", "mailboxId", "messageIds", "count"}, match[0]
assert len(match[0]["messageIds"]) == min(match[0]["count"], 3), match[0]
print("ok:", match[0])
' "$inbox_id" || fail "no notification job was queued for the new mail"

step "Nothing went wrong in the server log"
# Warnings or worse that mention this app, except the rejection above,
# which this test caused on purpose
problems="$(docker exec "$name" sh -c 'cat /var/www/html/data/nextcloud.log 2>/dev/null || true' \
	| grep -i 'mail_mobile\|MailMobile' \
	| grep -v '"level":[01],' \
	| grep -v 'Rejected a push subscription' || true)"
if [ -n "$problems" ]; then
	echo "$problems" | tail -n 5 >&2
	fail "warnings or errors from Mail Mobile in the log"
fi
# No push address in any log: neither the web server's access log (where
# a push address in a web address would land, URL-encoded) nor Nextcloud's
leaks="$({ docker logs "$name" 2>&1; docker exec "$name" sh -c 'cat /var/www/html/data/nextcloud.log 2>/dev/null || true'; } \
	| grep -ciE 'fcm(/|%2f)send' || true)"
[ "$leaks" = "0" ] || fail "a push address was written to a log ($leaks lines)"
echo "ok: no warnings from Mail Mobile, no push address in any log"

step "With Mail turned off, the page says Mail is needed"
occ app:disable mail
sleep 4 # the settings memory cache again
status="$(curl -s -o "$work/page.html" -w '%{http_code}' -u "admin:$password" "$base/index.php/apps/mail_mobile/")"
[ "$status" = "200" ] || fail "phone page answered $status without Mail"
grep -q 'Mail Mobile needs the Mail app' "$work/page.html" || { grep -o '<main.*' "$work/page.html" | head -n 5 >&2; fail "no plain 'needs Mail' message"; }
echo "ok"

printf '\nAll checks passed: Nextcloud %s, Mail %s\n' "$NC_MAJOR" "$MAIL_VERSION"
