<!--
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Mail Mobile

A phone-friendly web page for [Nextcloud Mail](https://github.com/nextcloud/mail).
Save it to your home screen on Android or iPhone and it opens like an app,
with optional notifications when new mail arrives.

Mail Mobile is a separate Nextcloud app that sits **beside** the official
Mail app. It does not change Mail, so Mail can update on its own schedule.

Mail Mobile is an independent project. It is not made by, endorsed by or
connected to Nextcloud GmbH; "Nextcloud" is their trademark.

What you can do on the phone page:

- read your inboxes and folders, with conversations grouped if you like
- search a folder by sender, recipient or subject
- swipe a message to archive or delete it, or select many at once
- move junk to the junk folder, and back to the inbox when it was not junk
- pin a message to the top of its folder (it carries a "Pinned" tag, which the full Mail app shows too)
- reply, reply all, forward, add Cc and Bcc, pick a sender address and a signature
- add another address to send from, straight from the From list
- attach files
- keep what you are writing: Back asks before discarding it, and a reload to sign in again brings it back
- get a notification on your phone when new mail arrives in an inbox

## What you need

| | Supported |
|---|---|
| Nextcloud | 33, 34, 35 |
| Mail app | 5.13 to 6.x (tested: 5.13.2, and 6.0.0-alpha.3 built from Mail's source) |
| PHP | 8.2 to 8.5 (whatever your Nextcloud version runs on) |
| Your server address | must use `https://` (phones only allow home-screen apps and notifications on secure sites) |
| Background jobs | Nextcloud's background jobs set to **Cron**, for notifications (see below) |

Mail 7 and newer are refused on purpose until they have been tested. The page
then says so in plain words instead of breaking.

Mail 6 has no published release yet. Mail Mobile is tested against Mail
6.0.0-alpha.3, built from Nextcloud's source code at the commit named in
[`scripts/build-mail.sh`](scripts/build-mail.sh). Nothing Mail Mobile uses
changed between Mail 5.13 and that build; Mail 6 only adds things.

**Words used below:**

- **occ** is Nextcloud's command-line tool. You run it on the server, from
  the Nextcloud folder, as the user the web server runs as.
- **www-data** is that user on Debian and Ubuntu. On other systems it may be
  `apache`, `nginx` or `http`.
- **custom_apps** is the folder inside your Nextcloud where apps you add
  yourself go. Some servers use the `apps` folder instead.
- **Cron** is a setting under **Administration settings → Basic settings →
  Background jobs**. It makes the server run Nextcloud's background work every
  5 minutes, which notifications rely on.

## Install

### From a release

1. Download `mail_mobile-<version>.tar.gz` from the
   [releases page](../../releases).
2. Unpack it into your Nextcloud's `custom_apps` folder, so you get a folder
   named `mail_mobile`.
3. Turn it on: `sudo -u www-data php occ app:enable mail_mobile`
   (or in Nextcloud: **Apps → Your apps → Mail Mobile → Enable**).
4. As an admin, open **Administration settings → Additional settings → Mail
   Mobile notifications** and enter a contact address such as
   `mailto:you@example.com`. Push services (Google, Apple and others) ask for
   one, and some refuse notifications without it.

### From this repository

You need Node 24, PHP 8.2 or newer and Composer.

```sh
npm ci --ignore-scripts && npm run build                         # the phone page, into js/
composer install --no-plugins --no-scripts && composer scope    # the web push library, into vendor-scoped/
scripts/build-release.sh                                         # puts it all in build/mail_mobile/
```

`--ignore-scripts`, `--no-plugins` and `--no-scripts` stop the packages'
own install scripts from running; this app does not need them.

Then copy `build/mail_mobile` into `custom_apps` and enable it as above.

## Use it on your phone

Open your Nextcloud's address followed by `/apps/mail_mobile/` on the phone
and sign in. Each person also finds the link under **Personal settings →
Mail Mobile**, and in the Nextcloud app menu.

**Android (Chrome, Edge, Firefox)**

1. Open the mailbox list (☰) and tap **Save to home screen**.
   Chrome shows its own install prompt; otherwise open the browser menu (⋮)
   and choose **Add to Home screen** or **Install app**.
2. To get notifications, tap **Enable notifications** in the mailbox list and allow them.
3. Tap **Send test notification** to check it works.

**iPhone and iPad (Safari, iOS 16.4 or newer for notifications)**

1. In Safari, tap the Share button, then **Add to Home Screen**.
2. Open **Mail Mobile** from the new home-screen icon. Notifications only
   work from the home-screen icon, not from inside Safari.
3. Open the mailbox list (☰), tap **Enable notifications** and allow them.
4. Tap **Send test notification** to check it works.

## How it relates to the official Mail app

- Mail Mobile uses **your Mail accounts exactly as Mail has them**. To add an
  account, change a password or set up a signature, use the full Mail app.
- The phone page talks to Mail through the same web addresses Mail's own
  screens use (`/apps/mail/api/...`). Every one of those calls is in one
  file, [`src/api/mail.js`](src/api/mail.js).
- The server side uses Mail's own code in exactly one file,
  [`lib/Mail/MailBridge.php`](lib/Mail/MailBridge.php). It checks that Mail is
  installed, turned on for you, and a version this app was tested with.
- Mail does not promise these as a public interface. When a Mail update
  changes one of them, those two files are the ones to fix. Until then, the
  page shows a plain message such as *"Mail Mobile needs the Mail app,
  version 5.13 to 6.x. This server has: Mail 7.0.0."*
- With Mail 6, an account can sign in to the mail server with your single
  sign-on login (OpenID Connect) instead of a password. When that sign-in
  expires and Mail cannot renew it, the phone page says so for that
  account and links to the full Mail app, where **Reconnect** renews it.
  For an account someone shared with you, it says that only the owner can
  reconnect it, since that sign-in is theirs.

## Notifications

How they work, step by step:

1. When you tap **Enable notifications**, your browser gives the server a
   private push address and two keys. They are stored in Nextcloud's
   database (table `oc_mail_mobile_push_subs`, at most 20 per person).
2. Mail checks for new mail in the background (or when you refresh).
   When it stores new mail in an **inbox**, Mail Mobile queues a small
   background job holding only numbers: who, which mailbox, which messages.
3. On the next cron run, the job builds the notification, encrypts it for
   your phone, and hands it to your browser's push service (Google, Mozilla,
   Apple or Microsoft).

**What a notification shows.** By default only "New mail" and how many
messages, because phones show notifications on the lock screen, where anyone
holding the phone can read them. You can choose to show the sender and
subject instead, on the phone page (mailbox list ☰) or under **Personal
settings → Mail Mobile**. The sender is then shown with their real address,
for example `IT Support <someone@example.com>`, because anyone can put any
name on an email. Up to 3 new messages get one notification each; more than
3 get one summary.

**Sending from other addresses.** The From list shows each account's
address and its aliases (Mail's name for other addresses an account sends
from). Its last choice, "Add an address …", adds one: type the address,
the name to show with it and, with several accounts, the account it sends
through (only your own accounts, never one shared with you). It is saved
in Mail as an alias, exactly as in Mail's own account
settings, so the full Mail app shows it too and can remove it. Mail does
not check that your mail server lets that account send from the address:
if the server does not, sending from it fails.

**Accounts shared with you.** Mail lets a person share (delegate) their
mail account with you. You can read and send from it on the phone page as
in Mail, but notifications for its new mail go only to its owner, never to
the people it is shared with.

**Accounts Mail reaches over JMAP** (new in Mail 6, set up by an admin
with `occ`) get no notifications: Mail does not announce their new mail
to other apps, so Mail's own notifications do not fire for them either.
Normal (IMAP) accounts are not affected.

**They are not instant.** A notification arrives after Mail's next background
check plus the next cron run. Mail checks every 15 minutes for people who
used Mail (or this page) in the last day, hourly after that, and every 6
hours after three days without use. An admin can set a fixed interval
(at least 5 minutes) with `app.mail.background-sync-interval` in
`config.php`. Instant notifications (watching the mailbox live) are not
part of this version.

**Server keys.** Web push needs a key pair for the server (called VAPID
keys). They are made when the app is installed, and never again on their
own. The private key is stored encrypted with your Nextcloud's secret. If it
cannot be read (for example after the secret changed), notifications stop
and the admin settings page says so. If the key may have leaked, or cannot
be read, make new keys:

```sh
sudo -u www-data php occ mail_mobile:vapid:reset
```

This also removes every subscription, so everyone turns notifications on
again on their phones.

## Privacy

- **What is stored:** for each phone or browser with notifications on: your
  user name, its push address and its two encryption keys (one public, one
  secret that only your browser and the server know), a short device name
  such as "Chrome on Android", which sign-in turned it on, and when.
- **When it is removed:** when you turn notifications off; when you sign out
  on that device; when you remove the device under **Personal settings →
  Security** or under **Personal settings → Mail Mobile**; when you change
  your password (all devices); when the push service says the address is
  gone; and when your Nextcloud account is deleted. If someone else signs in
  on the same browser, the phone page turns your notifications off there.
- **On the phone:** mail the page loaded is kept in its memory only while it
  is open, never saved on the phone. A message you are writing is put in
  the browser's session storage only while the page reloads (to sign you in
  again, or for an updated version) and deleted as soon as the page is
  back; it is never brought back after an hour or for anyone else who
  signed in on that browser.
- **What leaves your server:** only the notifications themselves, sent to the
  push service of your phone's browser. Their content is encrypted for your
  phone; the push service cannot read it. It can see that a notification was
  sent and when, your server's internet address, and the contact address the
  admin entered.
- **What your lock screen shows:** "New mail" unless you chose to show the
  sender and subject (see Notifications above).
- **Where the server may send:** only to the known push services listed in
  [`lib/Service/EndpointPolicy.php`](lib/Service/EndpointPolicy.php), over
  https. Any other address is refused, so the server cannot be made to send
  requests to machines on its own network.
- **What waits in the background-job table:** only numbers (user, mailbox and
  message ids). Sender names and subjects are read when the job runs.
- Nothing else is collected, and the app sends nothing anywhere else.

## For developers

```sh
npm ci --ignore-scripts
npm test                 # front-end unit tests (vitest)
npm run lint             # eslint
npm run build            # production build into js/

composer install --no-plugins --no-scripts
composer scope           # rename the web push library into vendor-scoped/
composer test:unit       # PHP unit tests
composer psalm           # static analysis
composer cs:check        # code style

scripts/build-release.sh
scripts/integration-test.sh 33 5.13.2   # Nextcloud 33 + Mail 5.13.2 in Docker

# Mail 6 has no release yet: build it from Mail's source first
scripts/build-mail.sh 6.0.0-alpha.3 build/mail-6.0.0-alpha.3.tar.gz
MAIL_TARBALL=build/mail-6.0.0-alpha.3.tar.gz scripts/integration-test.sh 35 6.0.0-alpha.3
```

The integration test starts a throwaway Nextcloud and a throwaway mail
server (Dovecot and Postfix, the image Mail's own tests use) in Docker,
all pinned by digest. It installs Mail (a release pinned by checksum, or a
build from `scripts/build-mail.sh`, which pins Mail's source commit) and
the built app, and checks the page, the manifest, the service worker, the
push key, the allowlist and sign-out. Then
[`scripts/check-mail-routes.py`](scripts/check-mail-routes.py) uses every
Mail address the phone page calls with a real mail account (folders, first
sync, list, reading, flags, searching, starring, pinning, junk, address
search, attachments, sending, moving, deleting), new inbox mail must queue a notification job, and with Mail
turned off the page must show the "needs Mail" message.

GitHub runs all of this on every push to `main` and on every pull request
(see `.github/workflows/ci.yml`), on GitHub's own runners, including the
integration test on Nextcloud 33, 34 and 35 with Mail 5.13.2 and with Mail
6.0.0-alpha.3. A version tag (`v0.2.0`) runs the same checks and, if they
pass, builds the release tarball (`.github/workflows/release.yml`).

### Layout

| Path | What it is |
|---|---|
| `lib/Mail/MailBridge.php` | the only PHP file that uses Mail's code |
| `src/api/mail.js` | every call to Mail's web addresses |
| `src/api/push.js` | calls to this app's own notification routes |
| `src/views/` | the phone screens (mailbox list, message list, reader, composer) |
| `src/sw.js` | the service worker that shows notifications |
| `src/reauth.js` | sends you back to the phone page after signing in again |
| `lib/Service/` | notifications: allowlist, server keys, sending |
| `lib/Listener/NewMailListener.php` | queues a notification when Mail stores new inbox mail |
| `lib/BackgroundJob/PushJob.php` | sends it on the next cron run |
| `scoper.inc.php`, `scripts/scope-vendor.php` | rename the web push library so it never clashes with Nextcloud's own copies |
| `scripts/build-mail.sh` | builds a Mail version that has no release yet from Mail's source, for the tests |
| `scripts/check-mail-routes.py` | the integration test's check of every Mail address the phone page calls |

## Not in this version

- instant notifications (watching the mailbox live with IMAP IDLE)
- reading mail offline
- signed or encrypted mail (S/MIME, PGP) in the composer. If your sender
  address has an S/MIME certificate, the composer says so and only sends
  unsigned after you tick a box; use the full Mail app for signed mail.
- notifications for accounts Mail reaches over JMAP (see Notifications)

## Licence

GNU Affero General Public License, version 3 or (at your option) any later
version (AGPL-3.0-or-later). See [LICENSE](LICENSE).

- Every file is under that licence, except the app icons, which are based
  on Google's Material icons (Apache-2.0); see `REUSE.toml`.
- Files that started in Nextcloud Mail, or were adapted from it, keep
  Nextcloud's copyright line next to Alex DiMarco's.
- Each file's first lines say this; the licence texts are in `LICENSES/`.

Because of the AGPL, if you run a changed copy for other people, you must
offer them its source code. The phone page and the settings page link to
the source.
