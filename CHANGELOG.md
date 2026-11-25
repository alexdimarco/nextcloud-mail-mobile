<!--
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Changelog

All notable changes to Mail Mobile are listed here.

## Unreleased

- The search box stays at the top of the list while the messages
  scroll, together with the Conversations and Select bar below it.

## 0.5.0 – 24 November 2026

- Junk: a Junk button on a message, and 🚫 for the messages selected in
  the list, move them to the account's junk folder, the way Mail's own
  "Mark as spam" does (Mail's server makes the move). In the junk folder
  the same buttons say "Not junk" and move them back to the inbox. Shown
  only when the account has a junk folder set (Mail finds it by itself
  when the mail server marks one; otherwise it is set in the full Mail
  app's account settings).
- Pin: 📌 on a message keeps it at the top of its folder's list, under
  "Pinned". Mail has no pin of its own, so a pinned message carries a tag
  named "Pinned", which the full Mail app shows too; the tag is made in
  Mail the first time something is pinned. Search results show 📌 on
  pinned messages instead of a separate heading.
- The refresh button turns while the list checks for new mail, then says
  "Up to date", or "Could not check for new mail". It also turns while
  the page checks by itself, such as when the phone wakes up.

## 0.4.0 – 22 November 2026

- A message being written is no longer lost:
  - Back, or the phone's back gesture, asks "Discard this message?" when
    something was typed, a recipient or the subject changed, or a file
    was attached. Keep writing stays; Discard leaves. With nothing
    written, Back leaves at once, as before.
  - When the page reloads while a message is being written (to sign in
    again when the Nextcloud session ran out, or for an updated version),
    the message opens again afterwards, with its sender, recipients and
    files already uploaded. A file still uploading is named, to attach
    again. It is held in the browser's session storage only during the
    reload, deleted as soon as it is back, and never brought back after
    an hour or for someone else who signed in on the phone.
- Search a folder: a search box at the top of the list looks for the
  words in the sender, the recipients and the subject, as Mail's own
  search box does, and in the message text too when the account's
  "search in message body" setting is on. It searches once typing
  pauses, or at once on Enter; ✕ shows the whole folder again. Back from
  a message returns to the same search; a folder opened from the list of
  folders starts unsearched.
- The star on a message shows whether it is starred also when the
  message was opened from a notification, is coloured when on, and has a
  name screen readers say ("Star", pressed or not). Two quick taps no
  longer send two changes.

## 0.3.0 – 21 November 2026

- On a slow or dead connection the page no longer waits for good:
  - Every call to Mail has a time limit: 20 seconds for reading and small
    changes, 2 minutes for sending and for checking the mail server for
    new mail, 10 minutes for uploading a file. When it runs out, or there
    is no connection, a banner says so, keeps what was already loaded on
    screen, and offers Try again.
  - A folder shows the list Mail already has at once, then checks the
    mail server for new mail in the background ("Checking for new mail …"
    only when that takes more than a second and a half). Before, the list
    stayed empty until that check finished.
  - Going back from a message shows the list straight away, at the same
    place, and a message opened earlier shows at once while the newest
    copy loads. Up to 10 lists and 20 messages are kept, in memory only:
    nothing is saved on the phone, and a reload forgets them.
  - A message that could not be loaded says why and offers Try again; a
    send with no answer says the message may still go out, so it is not
    sent twice.
- Add an address to send from without leaving the phone: the From list's
  last choice, "Add an address …", asks for the address, the name to show
  with it and, with several accounts, the account it sends through. It is
  saved in Mail as an alias, as Mail's own account settings do, and is
  picked at once. An address you already have is picked instead of being
  added twice. Your mail server must allow the account to send from it.
  Addresses are added only to your own accounts, never to one someone
  shared with you.
- The From line is now always a list, even with one address, because
  it always offers adding another.
- The integration test adds an address in Mail 5.13.2 and Mail 6, sends
  from it, checks it is the sender of the copy in Sent, and removes it.

## 0.2.2 – 21 November 2026

- The From line is always shown when writing a message. With more than
  one address to send from, it is a box with a down arrow that lists
  every account's address and all its aliases; with one address, that
  address is shown as plain text. Before, it was hidden with one address
  and looked like plain text with several, so it was easy to miss.

## 0.2.1 – 20 November 2026

Two fixes on the phone page.

- Reply, reply all and forward start from the alias the mail was sent to,
  with that alias's signature, instead of always from the account's main
  address. The first of the account's own addresses in To, then Cc,
  decides; when none is visible (Bcc, a mailing list) it stays the main
  address. The From list can still change it.
- The back arrow works on a message opened from a notification: it goes
  to that message's folder. Before, it did nothing, because the page had
  no earlier page to go back to.

## 0.2.0 – 16 November 2026

Works with Mail 6 as well as Mail 5.13.

- Supported Mail versions: 5.13 to 6.x. Tested with Mail 5.13.2 and with
  Mail 6.0.0-alpha.3 (no Mail 6 release exists yet; it is built from
  Nextcloud's source at a pinned commit), on Nextcloud 33, 34 and 35.
  Every Mail class, event, web address and answer field this app uses was
  compared between the two; none was removed or changed, Mail 6 only adds.
- The message for an unsupported Mail now reads, for example: "Mail Mobile
  needs the Mail app, version 5.13 to 6.x. This server has: Mail 7.0.0."
  The phone page and personal settings share one wording.
- Mail 6 accounts that sign in to the mail server with single sign-on:
  when that sign-in expired and Mail could not renew it, the phone page
  names the account and links to the full Mail app to reconnect it.
- New-mail notifications use Mail 6's own test for "this is the inbox"
  (marked as the inbox, or named INBOX).
- The integration test now uses a real mail server and checks every Mail
  address the phone page calls, and that new inbox mail queues a
  notification. CI runs it with Mail 5.13.2 and Mail 6.0.0-alpha.3.
- Accounts someone shared with you (Mail's delegation): the reconnect
  banner says only the owner can reconnect it, and the README says
  notifications for such an account go only to its owner.
- Names, addresses and file names inserted into messages on the page show
  exactly as they are ("AT&T", "o'brien@…"), no longer as "&amp;" or
  "&#39;". They were escaped twice; they are still shown only as text.
- The push address is no longer sent in a web address when notifications
  are turned off, and failed sends log only a short fingerprint of it, the
  push service's name and the HTTP status. Push addresses, browser keys,
  the server's push key and notification text are marked sensitive, so
  PHP leaves them out of error traces; the log lines that could carry them
  in a trace no longer attach the error itself.
- Release runs build and package only this app: building Mail from source
  happens only for pull requests and pushes, and every package install in
  CI runs with install scripts and Composer plugins off.
- scripts/check-mail-routes.py refuses any server that is not on the same
  machine.

## 0.1.0 – not released

First version as a separate app beside the official Nextcloud Mail app.

- The phone page at `/apps/mail_mobile/`: mailboxes, message list with
  conversations, swipe to archive or delete, select many, reader, composer
  (reply, reply all, forward, Cc and Bcc, sender address, signature, attachments).
- Save to the home screen on Android and iPhone.
- Web push notifications for new inbox mail, with a test button. They say
  only "New mail" unless the person chooses to show sender and subject.
- Notifications stop when the sign-in that turned them on ends (sign-out, or
  the device removed under Security), on a password change, and when a
  device is removed from the list under Personal settings.
- An admin setting for the contact address push services require.
- Works with Mail 5.13 and newer, older than 7, on Nextcloud 33 to 35.
  With any other Mail, the page says so in plain words.
- Server keys for notifications stored encrypted, made only at install or by
  `occ mail_mobile:vapid:reset`, never silently replaced.
- Notification jobs hold only ids; sender and subject are read when sending.
- A link in the app menu and under Personal settings.
- Brings you back to the phone page after signing in again through single
  sign-on, without reloading in a loop when that does not help.
- Message bodies shown in a frame where scripts cannot run; plain-text mail
  shown as text only.
- Never sends unsigned mail from an address with an S/MIME certificate
  without asking first.
- One licence for every file: AGPL-3.0-or-later (version 3 or any later
  version), except the icons (Apache-2.0).
