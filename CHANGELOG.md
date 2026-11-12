<!--
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-only
-->
# Changelog

All notable changes to Mail Mobile are listed here.

## 0.1.0 – not released yet

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
