<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="reader">
		<div v-if="error" class="reader__status">
			{{ error }}
			<button class="reader__retry" @click="retry">
				{{ t('mail_mobile', 'Try again') }}
			</button>
		</div>
		<div v-else-if="!message" class="reader__status">
			{{ t('mail_mobile', 'Loading …') }}
		</div>

		<template v-else>
			<div class="reader__head">
				<h2 class="reader__subject">
					{{ message.subject || t('mail_mobile', '(No subject)') }}
				</h2>
				<div class="reader__meta">
					<strong>{{ senderLabel }}</strong>
					<span class="reader__addr">{{ senderEmail }}</span>
					<span class="reader__date">{{ formatDate }}</span>
				</div>
			</div>

			<div v-if="attachments.length" class="reader__attachments">
				<a
					v-for="attachment in attachments"
					:key="attachment.id"
					class="reader__attachment"
					:href="attachment.downloadUrl"
					target="_blank"
					rel="noopener">
					📎 {{ attachment.fileName }}
					<span class="reader__attachment-size">{{ humanSize(attachment.size) }}</span>
				</a>
			</div>

			<!-- Sandboxed with no allow-scripts: even if Mail's cleaning or its
			     security header ever let a script through, it cannot run here.
			     allow-same-origin only lets resizeFrame() measure the page;
			     never add allow-scripts next to it. -->
			<iframe
				v-if="message.hasHtmlBody"
				ref="frame"
				class="reader__frame"
				:src="frameUrl"
				sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
				:title="t('mail_mobile', 'Message body')"
				@load="resizeFrame" />
			<!-- Plain-text mail: shown as text, never as HTML; links are found here -->
			<PlainText v-else class="reader__plain" :parts="plainParts" />

			<div class="reader__actions">
				<button class="reader__action reader__action--primary" @click="reply">
					{{ t('mail_mobile', 'Reply') }}
				</button>
				<button v-if="canReplyAll" class="reader__action" @click="replyAll">
					{{ t('mail_mobile', 'Reply all') }}
				</button>
				<button class="reader__action" @click="forward">
					{{ t('mail_mobile', 'Forward') }}
				</button>
				<button
					class="reader__action reader__action--star"
					:class="{ 'reader__action--starred': flagged }"
					:aria-pressed="flagged ? 'true' : 'false'"
					:aria-label="t('mail_mobile', 'Star')"
					:title="flagged ? t('mail_mobile', 'Starred: tap to remove the star') : t('mail_mobile', 'Star this message')"
					:disabled="flagging"
					@click="toggleFlagged">
					{{ flagged ? '★' : '☆' }}
				</button>
				<button class="reader__action" @click="markUnread">
					{{ t('mail_mobile', 'Unread') }}
				</button>
				<button v-if="canDelete" class="reader__action reader__action--danger" @click="remove">
					{{ t('mail_mobile', 'Delete') }}
				</button>
			</div>
		</template>
	</div>
</template>

<script>
import { deleteMessage, fetchMessage, htmlBodyUrl, setFlags } from '../api/mail.js'
import logger from '../logger.js'
import { recallMessage, rememberMessage } from '../memory.js'
import { accountFor, findMailbox, store } from '../store.js'

// Web addresses and email addresses in plain text. Trailing punctuation
// is left out of the link, as in "see https://example.com."
const LINK_PATTERN = /(\bhttps?:\/\/[^\s<>"']+|\bmailto:[^\s<>"']+|[\w.%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/**
 * The text of a plain-text message, from the HTML Mail sends for it.
 * DOMParser builds an inert document: nothing in it loads or runs.
 *
 * @param {string} html Mail's escaped and linkified body
 * @return {string} the plain text
 */
export function htmlToText(html) {
	const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
	return doc.body.textContent ?? ''
}

/**
 * Split plain text into text and link parts, for rendering as text nodes
 * and <a> elements (never as HTML).
 *
 * @param {string} text the plain text
 * @return {Array<{text: string, href?: string}>} the parts in order
 */
export function linkify(text) {
	const parts = []
	let last = 0
	for (const match of text.matchAll(LINK_PATTERN)) {
		let found = match[0]
		const trailing = found.match(TRAILING_PUNCTUATION)
		if (trailing) {
			found = found.slice(0, -trailing[0].length)
		}
		if (found === '') {
			continue
		}
		if (match.index > last) {
			parts.push({ text: text.slice(last, match.index) })
		}
		const href = /^(https?|mailto):/i.test(found) ? found : 'mailto:' + found
		parts.push({ text: found, href })
		last = match.index + found.length
	}
	if (last < text.length) {
		parts.push({ text: text.slice(last) })
	}
	return parts
}

/**
 * Escape text that goes into the forward header markup
 *
 * @param {string} text the raw text
 * @return {string} html-safe text
 */
function escapeHtml(text) {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

// Text nodes and links built by Vue's render function: the text is never
// parsed as HTML, so nothing in a message can add elements to the page
const PlainText = {
	name: 'PlainText',
	functional: true,
	props: {
		parts: {
			type: Array,
			required: true,
		},
	},

	render(h, { props, data }) {
		return h('div', data, props.parts.map((part) => (part.href
			? h('a', { attrs: { href: part.href, target: '_blank', rel: 'noopener noreferrer' } }, part.text)
			: part.text)))
	},
}

export default {
	name: 'Reader',
	components: { PlainText },
	props: {
		messageId: {
			type: Number,
			required: true,
		},

		// Raised by the page's Try again and refresh buttons
		refreshTick: {
			type: Number,
			default: 0,
		},
	},

	data() {
		const message = recallMessage(this.messageId)
		const listed = store.currentEnvelope?.databaseId === this.messageId ? store.currentEnvelope : null
		return {
			store,
			// Opened before during this visit: shown at once, then updated
			message,
			error: null,
			// Starred ("flagged" in Mail): from the list, or the copy
			// remembered, until Mail's answer says
			flagged: !!(listed?.flags?.flagged ?? message?.flags?.flagged),
			flagging: false,
		}
	},

	computed: {
		frameUrl() {
			return htmlBodyUrl(this.messageId)
		},

		plainParts() {
			return linkify(htmlToText(this.message.body))
		},

		senderLabel() {
			const from = this.message.from && this.message.from[0]
			return from ? (from.label || from.email) : '—'
		},

		senderEmail() {
			const from = this.message.from && this.message.from[0]
			return from ? from.email : ''
		},

		formatDate() {
			const envelope = this.store.currentEnvelope
			if (!envelope) {
				return ''
			}
			return new Date(envelope.dateInt * 1000).toLocaleString()
		},

		attachments() {
			return this.message.attachments ?? []
		},

		canDelete() {
			const mailbox = findMailbox(this.message.mailboxId)
			const account = mailbox && accountFor(mailbox)
			return !!(account && account.trashMailboxId)
		},

		ownAddresses() {
			const own = new Set()
			for (const account of this.store.accounts ?? []) {
				if (account.emailAddress) {
					own.add(account.emailAddress.toLowerCase())
				}
				for (const alias of account.aliases ?? []) {
					if (alias.alias) {
						own.add(alias.alias.toLowerCase())
					}
				}
			}
			return own
		},

		// Only worth offering when it reaches somebody a plain reply would not
		canReplyAll() {
			const recipients = this.replyAllRecipients()
			return recipients.to.length + recipients.cc.length > 1
		},
	},

	watch: {
		refreshTick() {
			this.retry()
		},
	},

	created() {
		window.addEventListener('resize', this.resizeFrame)
		this.load()
	},

	beforeDestroy() {
		window.removeEventListener('resize', this.resizeFrame)
	},

	methods: {
		async load() {
			let message
			try {
				message = await fetchMessage(this.messageId)
			} catch (error) {
				logger.error('could not load message', error)
				if (this.message) {
					// Keep showing the copy loaded earlier in this visit
					return
				}
				if (this.store.authError) {
					this.error = this.t('mail_mobile', 'Cannot load the message: the account cannot sign in to the mail server right now.')
				} else if (this.store.offline) {
					this.error = this.t('mail_mobile', 'No connection to the server, so this message could not be loaded.')
				} else {
					this.error = this.t('mail_mobile', 'Could not load this message')
				}
				return
			}
			this.message = message
			rememberMessage(this.messageId, message)

			// Mail's answer has the message's flags, also when it was opened
			// from a notification, with no list behind it
			this.flagged = !!(message.flags?.flagged ?? this.listedEnvelope()?.flags?.flagged)

			// A failed seen-flag write must not hide the loaded message
			try {
				const envelope = this.store.currentEnvelope
				if (envelope && !envelope.flags.seen) {
					await setFlags(this.messageId, { seen: true })
					envelope.flags.seen = true
				}
			} catch (error) {
				logger.error('could not mark message as seen', error)
			}
		},

		retry() {
			this.error = null
			this.load()
		},

		resizeFrame() {
			const frame = this.$refs.frame
			if (!frame) {
				return
			}
			try {
				const doc = frame.contentDocument
				// Fixed-width (table based) emails: scale down to fit instead
				// of clipping at the right edge
				doc.body.style.zoom = ''
				const width = doc.documentElement.scrollWidth
				const available = frame.clientWidth
				if (width > available && available > 0) {
					doc.body.style.zoom = String(available / width)
				}
				const height = doc.documentElement.scrollHeight
				frame.style.height = Math.max(height + 24, 200) + 'px'
			} catch {
				frame.style.height = '60vh'
			}
		},

		// Reply-To wins over From, like every other mail client
		senderRecipients() {
			const source = (this.message.replyTo && this.message.replyTo.length
				? this.message.replyTo
				: this.message.from) ?? []
			return source.map((recipient) => ({ label: recipient.label ?? recipient.email, email: recipient.email }))
		},

		// The alias the mail was sent to, so the answer goes out from the
		// same address. The first of the account's own addresses found in
		// To, then Cc, wins. Null for the account's main address, for an
		// alias of another account, and when no own address is visible
		// (Bcc, a mailing list).
		replyAliasId() {
			const account = (this.store.accounts ?? []).find((candidate) => candidate.id === this.message.accountId)
			if (!account) {
				return null
			}
			const main = account.emailAddress?.toLowerCase()
			for (const recipient of [...(this.message.to ?? []), ...(this.message.cc ?? [])]) {
				const email = recipient.email?.toLowerCase()
				if (!email) {
					continue
				}
				if (email === main) {
					return null
				}
				const alias = (account.aliases ?? []).find((candidate) => candidate.alias?.toLowerCase() === email)
				if (alias) {
					return alias.id
				}
			}
			return null
		},

		reply() {
			this.$emit('reply', {
				accountId: this.message.accountId,
				aliasId: this.replyAliasId(),
				to: this.senderRecipients(),
				subject: this.replySubject(),
				inReplyToMessageId: this.message.messageId ?? null,
			})
		},

		replySubject() {
			const subject = this.message.subject ?? ''
			return /^re:/i.test(subject) ? subject : `Re: ${subject}`
		},

		// Everyone still in the conversation, minus our own addresses. The
		// sender comes first, then the other To recipients; Cc stays Cc.
		replyAllRecipients() {
			const message = this.message
			const source = (message.replyTo && message.replyTo.length ? message.replyTo : message.from) ?? []
			const seen = new Set()
			const pick = (list) => (list ?? [])
				.filter((recipient) => recipient.email
					&& !this.ownAddresses.has(recipient.email.toLowerCase())
					&& !seen.has(recipient.email.toLowerCase())
					&& seen.add(recipient.email.toLowerCase()))
				.map((recipient) => ({ label: recipient.label ?? recipient.email, email: recipient.email }))
			const to = [...pick(source), ...pick(message.to)]
			const cc = pick(message.cc)
			return { to, cc }
		},

		replyAll() {
			const recipients = this.replyAllRecipients()
			this.$emit('reply', {
				accountId: this.message.accountId,
				aliasId: this.replyAliasId(),
				// A mail we sent only to ourselves still needs a recipient
				to: recipients.to.length ? recipients.to : this.senderRecipients(),
				cc: recipients.cc,
				subject: this.replySubject(),
				inReplyToMessageId: this.message.messageId ?? null,
			})
		},

		forward() {
			const message = this.message
			const subject = message.subject ?? ''
			const sender = (message.from ?? [])[0]
			const reference = (attachment, type) => ({
				type,
				id: attachment.id,
				mailboxId: message.mailboxId,
				uid: message.uid,
				fileName: attachment.fileName,
				size: attachment.size,
			})
			this.$emit('forward', {
				accountId: message.accountId,
				aliasId: this.replyAliasId(),
				to: [],
				subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`,
				// HTML mail comes sanitized by Mail; its inline images carry
				// data-cid, which the MIME builder turns back into a cid:
				// reference once the parts are attached. Plain-text mail is
				// escaped here, not trusted from Mail's markup.
				forwardedHtml: this.forwardHeaderHtml() + (message.hasHtmlBody
					? (message.body ?? '')
					: escapeHtml(htmlToText(message.body)).replace(/\r?\n/g, '<br>')),
				forwardedFrom: sender?.label || sender?.email || '',
				// Attachments live on the original message on the server; the
				// backend copies them when it sees a message-attachment ref
				attachments: (message.attachments ?? [])
					.map((attachment) => reference(attachment, 'message-attachment')),
				inlineAttachments: (message.inlineAttachments ?? [])
					.map((attachment) => reference(attachment, 'message-attachment-inline')),
			})
		},

		forwardHeaderHtml() {
			const message = this.message
			const addresses = (list) => (list ?? [])
				.map((recipient) => (recipient.label && recipient.label !== recipient.email
					? `${recipient.label} <${recipient.email}>`
					: recipient.email))
				.join(', ')
			const sent = message.dateInt ? new Date(message.dateInt * 1000).toLocaleString() : ''
			const rows = [
				['From', addresses(message.from)],
				['Date', sent],
				['Subject', message.subject ?? ''],
				['To', addresses(message.to)],
			]
			return `<div>---------- ${escapeHtml(this.t('mail_mobile', 'Forwarded message'))} ----------</div>`
				+ rows
					.filter(([, value]) => value !== '')
					.map(([label, value]) => `<div>${escapeHtml(this.t('mail_mobile', label))}: ${escapeHtml(value)}</div>`)
					.join('')
					+ '<br>'
		},

		// The list's entry for this message, if it was opened from the list
		listedEnvelope() {
			const envelope = this.store.currentEnvelope
			return envelope?.databaseId === this.messageId ? envelope : null
		},

		// Star or unstar: shown at once, undone if Mail does not take it.
		// The list's ★ and the copy remembered for this visit follow.
		async toggleFlagged() {
			if (this.flagging) {
				return
			}
			const value = !this.flagged
			this.flagged = value
			this.flagging = true
			try {
				await setFlags(this.messageId, { flagged: value })
				const envelope = this.listedEnvelope()
				if (envelope) {
					envelope.flags.flagged = value
				}
				if (this.message?.flags) {
					this.message.flags.flagged = value
				}
			} catch (error) {
				this.flagged = !value
				logger.error('could not flag message', error)
			} finally {
				this.flagging = false
			}
		},

		async markUnread() {
			try {
				await setFlags(this.messageId, { seen: false })
				if (this.store.currentEnvelope) {
					this.store.currentEnvelope.flags.seen = false
				}
				this.$emit('deleted') // navigate back to the list
			} catch (error) {
				logger.error('could not mark message unread', error)
			}
		},

		async remove() {
			if (!window.confirm(this.t('mail_mobile', 'Delete this message?'))) {
				return
			}
			try {
				await deleteMessage(this.messageId)
				this.$emit('deleted')
			} catch (error) {
				logger.error('could not delete message', error)
			}
		},

		humanSize(bytes) {
			if (!bytes) {
				return ''
			}
			const units = ['B', 'KB', 'MB', 'GB']
			let value = bytes
			let unit = 0
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024
				unit++
			}
			return `${Math.round(value * 10) / 10} ${units[unit]}`
		},
	},
}
</script>

<style scoped>
.reader {
	display: flex;
	flex-direction: column;
	min-height: calc(100dvh - 60px);
}
.reader__status {
	padding: 40px 16px;
	text-align: center;
	color: var(--mob-text-muted);
}
.reader__retry {
	display: block;
	margin: 16px auto 0;
	padding: 10px 16px;
	border: 1px solid var(--mob-accent);
	border-radius: var(--mob-radius);
	background: var(--mob-accent-soft);
	color: var(--mob-accent);
	font-size: 14px;
	cursor: pointer;
}
.reader__head {
	padding: 16px;
	border-bottom: 1px solid var(--mob-border);
}
.reader__subject {
	margin: 0 0 6px;
	font-size: 18px;
	line-height: 1.3;
}
.reader__meta {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	font-size: 13px;
	align-items: baseline;
}
.reader__addr,
.reader__date {
	color: var(--mob-text-muted);
}
.reader__date {
	margin-inline-start: auto;
}
.reader__attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding: 10px 16px;
	border-bottom: 1px solid var(--mob-border);
}
.reader__attachment {
	padding: 6px 10px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	font-size: 13px;
	text-decoration: none;
	color: var(--mob-text);
	background-color: var(--mob-hover);
}
.reader__attachment-size {
	color: var(--mob-text-muted);
}
.reader__frame {
	flex: 1;
	width: 100%;
	border: none;
	background-color: #fff;
}
.reader__plain {
	flex: 1;
	margin: 0;
	padding: 16px;
	white-space: pre-wrap;
	word-break: break-word;
	font-family: inherit;
	font-size: 15px;
}
.reader__actions {
	position: sticky;
	bottom: 0;
	display: flex;
	gap: 8px;
	padding: 10px 16px;
	padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
	background-color: var(--mob-bg);
	border-top: 1px solid var(--mob-border);
}
.reader__action {
	flex: 1;
	padding: 10px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	background: transparent;
	color: var(--mob-text);
	font-size: 14px;
	cursor: pointer;
}
.reader__action--primary {
	background-color: var(--mob-accent);
	border-color: var(--mob-accent);
	color: var(--mob-accent-text);
}
.reader__action--danger {
	color: var(--mob-danger);
}
/* The star: larger than the words beside it, and the list's colour when on */
.reader__action--star {
	flex: 0 0 auto;
	min-width: 44px;
	font-size: 18px;
	line-height: 1;
}
.reader__action--starred {
	border-color: var(--mob-star);
	color: var(--mob-star);
}
</style>
