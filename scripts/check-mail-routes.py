#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Alex DiMarco
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Check every Mail web address the phone page calls, against a real
Nextcloud with the Mail app and a real IMAP and SMTP server.

Run by scripts/integration-test.sh once Nextcloud, Mail, Mail Mobile and
a throwaway mail server are up, and the mail account exists in Mail. It
signs in like a browser and uses the addresses in src/api/mail.js in the
order a person would: accounts, folders, the first sync, the message
list, a message, its HTML, its conversation, flags, address search, an
attachment upload, sending through the outbox, moving, deleting. Then it
turns notifications on and lets one new message arrive, so the caller
can check that Mail Mobile queued a notification for it.

Only the Python standard library is used. The Nextcloud password comes
from the environment (NC_PASSWORD), not the command line.

Usage: NC_PASSWORD=... check-mail-routes.py --base http://localhost:8089
           --user admin --mail-user user@domain.tld --mail-password ...
           --imap-port 3143 --mail-version 6.0.0-alpha.3
Prints the inbox's database id on its last line.
"""

import argparse
import http.cookiejar
import imaplib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email.message import EmailMessage
from email.utils import formatdate, make_msgid


def fail(message):
    print(f'FAIL: {message}', file=sys.stderr)
    sys.exit(1)


def ok(message):
    print(f'ok: {message}')


class Session:
    """A browser-like session: cookies, and the anti-forgery token."""

    def __init__(self, base):
        self.base = base.rstrip('/')
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.token = None

    def request(self, method, path, body=None, form=None, upload=None,
                headers=None, expect=(200,)):
        sent = {'Accept': 'application/json'}
        if self.token:
            sent['requesttoken'] = self.token
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            sent['Content-Type'] = 'application/json'
        elif form is not None:
            data = urllib.parse.urlencode(form).encode()
            sent['Content-Type'] = 'application/x-www-form-urlencoded'
        elif upload is not None:
            field, name, content = upload
            boundary = uuid.uuid4().hex
            data = (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; '
                    f'filename="{name}"\r\nContent-Type: text/plain\r\n\r\n').encode() \
                + content + f'\r\n--{boundary}--\r\n'.encode()
            sent['Content-Type'] = f'multipart/form-data; boundary={boundary}'
        sent.update(headers or {})
        req = urllib.request.Request(self.base + path, data=data, headers=sent, method=method)
        try:
            with self.opener.open(req, timeout=120) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        if expect is not None and status not in expect:
            fail(f'{method} {path} answered {status}: {raw[:400]!r}')
        return status, raw

    def json(self, method, path, **kwargs):
        status, raw = self.request(method, path, **kwargs)
        try:
            return status, (json.loads(raw) if raw else None)
        except ValueError:
            fail(f'{method} {path} did not answer with JSON: {raw[:200]!r}')

    def login(self, user, password):
        _, page = self.request('GET', '/index.php/login', headers={'Accept': 'text/html'})
        found = re.search(rb'data-requesttoken="([^"]+)"', page)
        if not found:
            fail('no anti-forgery token on the sign-in page')
        # Nextcloud only accepts a sign-in form sent from its own pages
        self.request('POST', '/index.php/login', form={
            'user': user, 'password': password, 'requesttoken': found.group(1).decode(),
        }, headers={'Origin': self.base, 'Accept': 'text/html'}, expect=None)
        _, answer = self.json('GET', '/index.php/csrftoken')
        self.token = answer['token']
        status, _ = self.request('GET', '/index.php/apps/mail/api/accounts', expect=None)
        if status != 200:
            fail(f'not signed in after the sign-in form (Mail answered {status})')


def require_keys(what, value, keys):
    if not isinstance(value, dict):
        fail(f'{what} is not an object: {value!r}'[:300])
    missing = [key for key in keys if key not in value]
    if missing:
        fail(f'{what} has no {", ".join(missing)} (keys: {", ".join(sorted(value))})')


def append_message(port, user, password, subject, html=True, attachment=False):
    """Put one message straight into the inbox over IMAP."""
    message = EmailMessage()
    message['From'] = 'Sam Sender <sam@example.com>'
    message['To'] = user
    message['Subject'] = subject
    message['Date'] = formatdate(localtime=True)
    message['Message-ID'] = make_msgid(domain='example.com')
    message.set_content(f'Plain text of {subject}\n')
    if html:
        message.add_alternative(f'<p>HTML of <b>{subject}</b></p>', subtype='html')
    if attachment:
        message.add_attachment(b'hello\n', maintype='text', subtype='plain', filename='note.txt')
    imap = imaplib.IMAP4('127.0.0.1', port)
    try:
        imap.login(user, password)
        status, _ = imap.append('INBOX', '', imaplib.Time2Internaldate(time.time()), message.as_bytes())
        if status != 'OK':
            fail(f'IMAP APPEND answered {status}')
    finally:
        imap.logout()


SYNC_BODY = {'ids': [], 'lastMessageTimestamp': None, 'init': False, 'sortOrder': 'newest', 'query': None}


def sync(session, mailbox_id):
    """The phone page's refresh: a quick sync, and a full first sync when
    Mail answers that the folder was never synced (428)."""
    path = f'/index.php/apps/mail/api/mailboxes/{mailbox_id}/sync'
    status, _ = session.request('POST', path, body=SYNC_BODY, expect=(200, 202, 412, 428))
    if status in (412, 428):
        session.request('POST', path, body={**SYNC_BODY, 'init': True}, expect=(200, 202))
    return status


def envelopes(session, mailbox_id, view='singleton'):
    query = urllib.parse.urlencode({'mailboxId': mailbox_id, 'limit': 25, 'view': view})
    _, listed = session.json('GET', f'/index.php/apps/mail/api/messages?{query}')
    if not isinstance(listed, list):
        fail(f'the message list is not a list: {listed!r}'[:300])
    return listed


def find_subject(session, mailbox_id, subject, tries=10):
    for _ in range(tries):
        for envelope in envelopes(session, mailbox_id):
            if envelope.get('subject') == subject:
                return envelope
        time.sleep(2)
        sync(session, mailbox_id)
    fail(f'"{subject}" is not in mailbox {mailbox_id}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--user', required=True)
    parser.add_argument('--mail-user', required=True)
    parser.add_argument('--mail-password', required=True)
    parser.add_argument('--imap-port', type=int, required=True)
    parser.add_argument('--mail-version', required=True)
    args = parser.parse_args()
    password = os.environ.get('NC_PASSWORD') or fail('NC_PASSWORD is not set')
    run = uuid.uuid4().hex[:8]
    mail = '/index.php/apps/mail'

    session = Session(args.base)
    session.login(args.user, password)

    # Accounts, with the fields the phone page reads
    _, accounts = session.json('GET', f'{mail}/api/accounts')
    account = next((a for a in accounts if a.get('emailAddress') == args.mail_user), None)
    if account is None:
        fail(f'Mail does not list the account {args.mail_user}')
    require_keys('an account', account, [
        'id', 'emailAddress', 'name', 'aliases', 'signature', 'smimeCertificateId',
        'archiveMailboxId', 'trashMailboxId',
    ])
    if args.mail_version.startswith('6.'):
        # The phone page shows a "reconnect" banner from this Mail 6 field
        require_keys('a Mail 6 account', account, ['oauthNeedsReauth'])
        if account['oauthNeedsReauth'] is not False:
            fail('a password account is marked as needing a new single sign-on')
    account_id = account['id']
    ok(f'accounts: {len(accounts)}, the test account is {account_id}')

    # Folders
    _, answer = session.json('GET', f'{mail}/api/mailboxes?accountId={account_id}')
    require_keys('the folder list', answer, ['mailboxes'])
    boxes = answer['mailboxes']
    inbox = next((b for b in boxes if b.get('specialRole') == 'inbox'), None)
    if inbox is None:
        fail(f'no folder has specialRole "inbox": {[b.get("name") for b in boxes]}')
    require_keys('a folder', inbox, ['databaseId', 'displayName', 'specialRole', 'unread', 'accountId'])
    folders = {}
    for name in ('Archive', 'Sent', 'Trash'):
        # Use the server's own folder when it has one (marked for this use,
        # or named so, also inside another folder such as "INBOX.Sent")
        folder = next((b for b in boxes if b.get('specialRole') == name.lower()), None) \
            or next((b for b in boxes if b['name'].split(b.get('delimiter') or '/')[-1].lower() == name.lower()), None)
        if folder is None:
            _, folder = session.json('POST', f'{mail}/api/mailboxes', body={'accountId': account_id, 'name': name})
        folders[name] = folder['databaseId']
    session.json('PATCH', f'{mail}/api/accounts/{account_id}', body={
        'archiveMailboxId': folders['Archive'],
        'sentMailboxId': folders['Sent'],
        'trashMailboxId': folders['Trash'],
    })
    ok(f'folders: inbox {inbox["databaseId"]}, archive, sent and trash set')
    inbox_id = inbox['databaseId']

    # A message arrives; the first refresh needs Mail's full first sync
    subject = f'Phone page check {run}'
    append_message(args.imap_port, args.mail_user, args.mail_password, subject, attachment=True)
    first = sync(session, inbox_id)
    envelope = find_subject(session, inbox_id, subject)
    require_keys('a message in the list', envelope, [
        'databaseId', 'subject', 'from', 'dateInt', 'flags', 'mailboxId', 'messageId',
        'threadRootId', 'inReplyTo', 'uid',
    ])
    if envelope['from'][0].get('email') != 'sam@example.com':
        fail(f'unexpected sender: {envelope["from"]!r}')
    envelopes(session, inbox_id, view='threaded')
    message_id = envelope['databaseId']
    ok(f'first refresh answered {first}; the message is listed (id {message_id}), threaded view answers')

    # Reading it
    _, body = session.json('GET', f'{mail}/api/messages/{message_id}/body')
    require_keys('a message', body, ['subject', 'from', 'to', 'cc', 'hasHtmlBody', 'attachments', 'mailboxId', 'uid', 'accountId'])
    if body['hasHtmlBody'] is not True or len(body['attachments']) != 1:
        fail(f'expected an HTML message with one attachment: hasHtmlBody={body["hasHtmlBody"]!r}, attachments={len(body["attachments"])}')
    require_keys('an attachment', body['attachments'][0], ['id', 'fileName', 'size'])
    _, html = session.request('GET', f'{mail}/api/messages/{message_id}/html?plain=true', headers={'Accept': 'text/html'})
    if subject.encode() not in html:
        fail('the HTML body does not contain the message')
    status, thread = session.json('GET', f'{mail}/api/messages/{message_id}/thread', expect=(200, 404))
    if status == 200 and not isinstance(thread, list):
        fail(f'the conversation is not a list: {thread!r}'[:300])
    session.request('PUT', f'{mail}/api/messages/{message_id}/flags', body={'flags': {'seen': True}})
    if not find_subject(session, inbox_id, subject)['flags']['seen']:
        fail('marking the message read did not stick')
    ok(f'body, HTML, conversation ({status}) and the read flag work')

    # Writing: address search, an attachment, sending through the outbox
    _, suggestions = session.json('GET', f'{mail}/api/autoComplete?term=sam')
    if not isinstance(suggestions, list):
        fail('address search did not answer with a list')
    _, uploaded = session.json('POST', f'{mail}/api/attachments', expect=(200, 201),
                               upload=('attachment', 'phone.txt', b'from the phone\n'))
    require_keys('an uploaded attachment', uploaded, ['id'])
    sent_subject = f'Sent from the phone page {run}'
    _, created = session.json('POST', f'{mail}/api/outbox', expect=(200, 201), body={
        'accountId': account_id, 'subject': sent_subject,
        'bodyPlain': 'Hello from the phone page', 'bodyHtml': None, 'editorBody': 'Hello from the phone page',
        'isHtml': False, 'smimeSign': False, 'smimeEncrypt': False,
        'to': [{'label': 'Me', 'email': args.mail_user}], 'cc': [], 'bcc': [],
        'attachments': [{'type': 'local', 'id': uploaded['id']}],
        'draftId': None, 'aliasId': None, 'inReplyToMessageId': None, 'smimeCertificateId': None,
        'sendAt': None, 'requestMdn': False, 'isPgpMime': False,
    })
    outbox_id = (created.get('data') or {}).get('id')
    if not outbox_id:
        fail(f'the outbox did not answer with an id: {created!r}'[:300])
    session.request('POST', f'{mail}/api/outbox/{outbox_id}', expect=(200, 202))
    # Mail keeps a copy in Sent only after the mail server took the message
    sync(session, folders['Sent'])
    sent = find_subject(session, folders['Sent'], sent_subject)
    ok(f'address search, upload and sending work; the copy is in Sent (id {sent["databaseId"]})')

    # Archiving (a move) and deleting (to the trash)
    session.request('POST', f'{mail}/api/messages/{message_id}/move', body={'destFolderId': folders['Archive']})
    sync(session, folders['Archive'])
    find_subject(session, folders['Archive'], subject)
    session.request('DELETE', f'{mail}/api/messages/{sent["databaseId"]}')
    sync(session, folders['Trash'])
    find_subject(session, folders['Trash'], sent_subject)
    ok('archiving and deleting work')

    # Mail's own page carries the small script that brings people back to
    # the phone page after signing in again
    _, page = session.request('GET', f'{mail}/', headers={'Accept': 'text/html'})
    if b'mail_mobile-reauth' not in page:
        fail("Mail's page does not load mail_mobile-reauth.js")
    ok("Mail's page loads the sign-in return script")

    # Notifications on, then new inbox mail
    session.request('POST', '/index.php/apps/mail_mobile/push', body={
        'endpoint': f'https://fcm.googleapis.com/fcm/send/it-new-mail-{run}', 'p256dh': 'x', 'auth': 'y',
    })
    append_message(args.imap_port, args.mail_user, args.mail_password, f'New mail {run}', html=False)
    sync(session, inbox_id)
    find_subject(session, inbox_id, f'New mail {run}')
    ok('notifications on, and new mail synced into the inbox')
    print(inbox_id)


if __name__ == '__main__':
    main()
