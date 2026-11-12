<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="reader">
		<div v-if="error" class="reader__status">
			{{ error }}
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

			<iframe
				v-if="message.hasHtmlBody"
				ref="frame"
				class="reader__frame"
				:src="frameUrl"
				:title="t('mail_mobile', 'Message body')"
				@load="resizeFrame" />
			<!-- body of plain-text mail is escaped and linkified by Mail on the server (UrlLinker), the same HTML Mail's desktop app shows with v-html -->
			<!-- eslint-disable-next-line vue/no-v-html -->
			<div v-else class="reader__plain" v-html="message.body" />

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
				<button class="reader__action" @click="toggleFlagged">
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
import { accountFor, findMailbox, store } from '../store.js'

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

export default {
	name: 'Reader',
	props: {
		messageId: {
			type: Number,
			required: true,
		},
	},

	data() {
		return {
			store,
			message: null,
			error: null,
			flagged: false,
		}
	},

	computed: {
		frameUrl() {
			return htmlBodyUrl(this.messageId)
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

	created() {
		window.addEventListener('resize', this.resizeFrame)
		this.load()
	},

	beforeDestroy() {
		window.removeEventListener('resize', this.resizeFrame)
	},

	methods: {
		async load() {
			try {
				this.message = await fetchMessage(this.messageId)
			} catch (error) {
				logger.error('could not load message', error)
				this.error = this.store.authError
					? this.t('mail_mobile', 'Cannot load the message: the account cannot sign in to the mail server right now.')
					: this.t('mail_mobile', 'Could not load this message')
				return
			}

			// A failed seen-flag write must not hide the loaded message
			try {
				const envelope = this.store.currentEnvelope
				this.flagged = !!envelope?.flags?.flagged
				if (envelope && !envelope.flags.seen) {
					await setFlags(this.messageId, { seen: true })
					envelope.flags.seen = true
				}
			} catch (error) {
				logger.error('could not mark message as seen', error)
			}
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

		reply() {
			this.$emit('reply', {
				accountId: this.message.accountId,
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
				to: [],
				subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`,
				// The body is already sanitized server-side (HTML mail) or
				// escaped and linkified (plain-text mail). Inline images in it
				// carry data-cid, which the MIME builder turns back into a
				// cid: reference once the parts are attached.
				forwardedHtml: this.forwardHeaderHtml() + (message.body ?? ''),
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

		async toggleFlagged() {
			this.flagged = !this.flagged
			try {
				await setFlags(this.messageId, { flagged: this.flagged })
				if (this.store.currentEnvelope) {
					this.store.currentEnvelope.flags.flagged = this.flagged
				}
			} catch (error) {
				this.flagged = !this.flagged
				logger.error('could not flag message', error)
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
</style>
