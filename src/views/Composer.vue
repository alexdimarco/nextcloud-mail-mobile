<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<form class="composer" @submit.prevent="send">
		<label v-if="identities.length > 1" class="composer__field">
			<span class="composer__label">{{ t('mail_mobile', 'From') }}</span>
			<select
				v-model="identityKey"
				class="composer__select"
				@change="onIdentityChange">
				<option
					v-for="identity in identities"
					:key="identity.key"
					:value="identity.key">
					{{ identity.name ? identity.name + ' <' + identity.email + '>' : identity.email }}
				</option>
			</select>
		</label>
		<label
			v-for="field in recipientFields"
			:key="field.key"
			class="composer__field composer__field--to">
			<span class="composer__label">{{ field.label }}</span>
			<input
				:ref="field.key + 'Input'"
				:value="recipientValue(field.key)"
				type="text"
				inputmode="email"
				autocapitalize="off"
				autocomplete="off"
				:placeholder="t('mail_mobile', 'recipient@example.com, …')"
				:required="field.key === 'to'"
				@input="onRecipientInput(field.key, $event.target.value)"
				@blur="hideSuggestionsSoon">
			<div v-if="suggestField === field.key && suggestions.length" class="composer__suggest">
				<button
					v-for="suggestion in suggestions"
					:key="suggestion.email"
					type="button"
					class="composer__suggest-item"
					@pointerdown.prevent="pickSuggestion(suggestion)"
					@click.prevent="pickSuggestion(suggestion)">
					<span class="composer__suggest-label">{{ suggestion.label || suggestion.email }}</span>
					<span class="composer__suggest-email">{{ suggestion.email }}</span>
				</button>
			</div>
		</label>
		<button
			v-if="!showCcBcc"
			type="button"
			class="composer__ccbcc"
			@click="showCcBcc = true">
			{{ t('mail_mobile', 'Add Cc/Bcc') }}
		</button>
		<label class="composer__field">
			<span class="composer__label">{{ t('mail_mobile', 'Subject') }}</span>
			<input v-model="subject" type="text">
		</label>
		<div class="composer__toolbar">
			<template v-if="usesHtml">
				<button
					type="button"
					class="composer__tool composer__tool--bold"
					:aria-label="t('mail_mobile', 'Bold')"
					@pointerdown.prevent="format('bold')"
					@click.prevent>
					B
				</button>
				<button
					type="button"
					class="composer__tool composer__tool--italic"
					:aria-label="t('mail_mobile', 'Italic')"
					@pointerdown.prevent="format('italic')"
					@click.prevent>
					I
				</button>
				<button
					type="button"
					class="composer__tool composer__tool--underline"
					:aria-label="t('mail_mobile', 'Underline')"
					@pointerdown.prevent="format('underline')"
					@click.prevent>
					U
				</button>
				<span class="composer__tool-sep" />
			</template>
			<button
				v-for="emoji in emojis"
				:key="emoji"
				type="button"
				class="composer__tool"
				@pointerdown.prevent="insertEmoji(emoji)"
				@click.prevent>
				{{ emoji }}
			</button>
		</div>

		<div
			v-if="usesHtml"
			ref="editor"
			class="composer__body composer__body--rich"
			contenteditable="true"
			:data-placeholder="t('mail_mobile', 'Write your message …')"
			@input="onEditorInput" />
		<textarea
			v-else
			ref="plainBody"
			v-model="body"
			class="composer__body"
			:placeholder="t('mail_mobile', 'Write your message …')"
			rows="10" />

		<div v-if="signatureOptions.length" class="composer__sigrow">
			<span class="composer__sigrow-status">
				{{ signatureHtml ? t('mail_mobile', '✓ Signature attached') : t('mail_mobile', 'No signature') }}
			</span>
			<select
				v-model="signatureKey"
				class="composer__sigselect"
				@change="signatureChosen = true">
				<option value="none">
					{{ t('mail_mobile', 'No signature') }}
				</option>
				<option
					v-for="opt in signatureOptions"
					:key="opt.key"
					:value="opt.key">
					{{ opt.name || opt.email }}
				</option>
			</select>
		</div>

		<div v-if="forwardedHtml" class="composer__forwarded">
			<span>
				{{ forwardedFrom
					? t('mail_mobile', '↪ Forwarded message from {sender} is included below', { sender: forwardedFrom }, AS_TEXT)
					: t('mail_mobile', '↪ Forwarded message is included below') }}
			</span>
			<button
				type="button"
				class="composer__forwarded-remove"
				:aria-label="t('mail_mobile', 'Do not forward the original message')"
				@click="dropForward">
				×
			</button>
		</div>

		<div v-if="attachments.length" class="composer__attachments">
			<span
				v-for="(attachment, index) in attachments"
				:key="index"
				class="composer__attachment">
				{{ attachment.uploading ? '⏳' : '📎' }} {{ attachment.fileName }}
				<button
					type="button"
					class="composer__attachment-remove"
					:aria-label="t('mail_mobile', 'Remove attachment')"
					@click="removeAttachment(index)">×</button>
			</span>
		</div>

		<div v-if="needsSmime" class="composer__notice composer__smime">
			<p>
				{{ t('mail_mobile', 'This address has an S/MIME certificate, but Mail Mobile cannot sign or encrypt mail. To send it signed or encrypted, use the full Mail app.') }}
			</p>
			<label>
				<input v-model="unsignedOk" type="checkbox">
				{{ t('mail_mobile', 'Send without signing or encryption') }}
			</label>
		</div>

		<div v-if="notice" class="composer__notice">
			{{ notice }}
		</div>

		<div class="composer__actions">
			<button type="button" class="composer__btn" @click="pickFile">
				📎 {{ t('mail_mobile', 'File') }}
			</button>
			<button type="button" class="composer__btn" @click="pickPhoto">
				📷 {{ t('mail_mobile', 'Photo') }}
			</button>
			<button
				type="submit"
				class="composer__btn composer__btn--send"
				:disabled="sending || uploading">
				{{ sending ? t('mail_mobile', 'Sending …') : t('mail_mobile', 'Send') }}
			</button>
		</div>

		<input
			ref="fileInput"
			type="file"
			multiple
			hidden
			@change="onFiles">
		<input
			ref="photoInput"
			type="file"
			accept="image/*,video/*"
			multiple
			hidden
			@change="onFiles">
	</form>
</template>

<script>
import { autocomplete, sendMessage, uploadAttachment } from '../api/mail.js'
import { AS_TEXT } from '../l10nText.js'
import logger from '../logger.js'
import { store } from '../store.js'

// Keep well below common SMTP message-size limits (encoding adds ~35%)
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

/**
 * One selectable sender identity per account and per alias.
 *
 * @param {Array} accounts the accounts from the store
 * @return {Array} identities
 */
function buildIdentities(accounts) {
	return (accounts ?? []).flatMap((account) => [
		{
			key: 'a' + account.id,
			accountId: account.id,
			aliasId: null,
			email: account.emailAddress,
			name: account.name,
			signature: account.signature,
			smimeCertificateId: account.smimeCertificateId ?? null,
		},
		...(account.aliases ?? []).map((alias) => ({
			key: 'l' + alias.id,
			accountId: account.id,
			aliasId: alias.id,
			email: alias.alias,
			name: alias.name,
			signature: alias.signature ?? account.signature,
			smimeCertificateId: alias.smimeCertificateId ?? null,
		})),
	])
}

/**
 * Signatures are stored as HTML (desktop rich editor); flatten to text
 * for the plain-text alternative part.
 *
 * @param {string|null} html the signature markup
 * @return {string} plain text
 */
function signatureToText(html) {
	if (!html) {
		return ''
	}
	// DOMParser builds an inert document: unlike innerHTML on an element
	// of this page, nothing in it loads (images) or runs
	const doc = new DOMParser().parseFromString(String(html)
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div)>/gi, '\n'), 'text/html')
	return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

export default {
	name: 'Composer',
	data() {
		const prefill = store.composerPrefill ?? {}
		const accountId = prefill.accountId ?? store.accounts[0]?.id
		const identities = buildIdentities(store.accounts)
		// A reply or forward starts from the alias the mail was sent to;
		// anything else, or an alias since removed, from the account itself
		const initial = identities.find((identity) => identity.accountId === accountId && identity.aliasId === (prefill.aliasId ?? null))
			?? identities.find((identity) => identity.accountId === accountId && identity.aliasId === null)
			?? identities[0]
		return {
			accountId,
			identityKey: initial?.key ?? null,
			signatureKey: initial?.signature ? initial.key : 'none',
			signatureChosen: false,
			to: (prefill.to ?? []).map((recipient) => recipient.email).join(', '),
			cc: (prefill.cc ?? []).map((recipient) => recipient.email).join(', '),
			bcc: (prefill.bcc ?? []).map((recipient) => recipient.email).join(', '),
			showCcBcc: (prefill.cc ?? []).length > 0 || (prefill.bcc ?? []).length > 0,
			subject: prefill.subject ?? '',
			inReplyToMessageId: prefill.inReplyToMessageId ?? null,
			forwardedHtml: prefill.forwardedHtml ?? null,
			forwardedFrom: prefill.forwardedFrom ?? '',
			// Images embedded in the forwarded body: not shown as chips, they
			// are part of the quoted message and travel with it
			forwardedInline: prefill.inlineAttachments ?? [],
			body: '',
			editorHtml: '',
			emojis: ['🙂', '😂', '😢', '😭', '🤷', '👍', '❤️', '🎉'],
			// Forwarded attachments are references the server resolves; local
			// uploads are added with an id by onFiles()
			attachments: (prefill.attachments ?? []).map((attachment) => ({ ...attachment, uploading: false })),
			sending: false,
			// The sender has an S/MIME certificate and the person agreed to
			// send this message unsigned anyway
			unsignedOk: false,
			notice: null,
			AS_TEXT,
			suggestions: [],
			suggestField: 'to',
			suggestTimer: null,
			hideTimer: null,
		}
	},

	computed: {
		recipientFields() {
			const fields = [{ key: 'to', label: this.t('mail_mobile', 'To') }]
			if (this.showCcBcc) {
				fields.push({ key: 'cc', label: this.t('mail_mobile', 'Cc') })
				fields.push({ key: 'bcc', label: this.t('mail_mobile', 'Bcc') })
			}
			return fields
		},

		identities() {
			return buildIdentities(store.accounts)
		},

		selectedIdentity() {
			return this.identities.find((identity) => identity.key === this.identityKey)
		},

		signatureOptions() {
			// Every identity (account + aliases) that has a signature
			return this.identities.filter((identity) => identity.signature)
		},

		signatureHtml() {
			if (this.signatureKey === 'none') {
				return null
			}
			return this.identities.find((identity) => identity.key === this.signatureKey)?.signature ?? null
		},

		usesHtml() {
			// Honor the account's Writing mode setting ('Rich text' = html).
			// Default to html when unset, like a fresh desktop install.
			const account = store.accounts.find((candidate) => candidate.id === this.selectedIdentity?.accountId)
			return account?.editorMode !== 'plaintext'
		},

		// Mail Mobile cannot sign or encrypt (S/MIME), so it never does that
		// silently: the person has to agree to send unsigned first
		needsSmime() {
			return !!this.selectedIdentity?.smimeCertificateId
		},

		uploading() {
			return this.attachments.some((attachment) => attachment.uploading)
		},

		totalBytes() {
			return this.attachments.reduce((sum, attachment) => sum + (attachment.size ?? 0), 0)
		},
	},

	methods: {
		onEditorInput() {
			this.editorHtml = this.$refs.editor?.innerHTML ?? ''
		},

		format(command) {
			const editor = this.$refs.editor
			if (!editor) {
				return
			}
			editor.focus()
			try {
				document.execCommand(command)
			} catch {
				// not supported (test environment)
			}
			this.onEditorInput()
		},

		insertEmoji(emoji) {
			if (this.usesHtml) {
				const editor = this.$refs.editor
				if (!editor) {
					return
				}
				editor.focus()
				let inserted
				try {
					inserted = document.execCommand('insertText', false, emoji)
				} catch {
					inserted = false
				}
				if (!inserted) {
					editor.innerHTML += emoji
				}
				this.onEditorInput()
				return
			}
			const el = this.$refs.plainBody
			const start = el?.selectionStart ?? this.body.length
			const end = el?.selectionEnd ?? start
			this.body = this.body.slice(0, start) + emoji + this.body.slice(end)
			this.$nextTick(() => {
				if (el) {
					el.focus()
					el.selectionStart = el.selectionEnd = start + emoji.length
				}
			})
		},

		onIdentityChange() {
			// Sending as another identity should attach that identity's
			// signature — unless the user picked one explicitly
			if (this.signatureChosen) {
				return
			}
			this.signatureKey = this.selectedIdentity?.signature ? this.selectedIdentity.key : 'none'
		},

		recipientValue(field) {
			return this[field]
		},

		onRecipientInput(field, value) {
			this[field] = value
			this.suggestField = field
			clearTimeout(this.suggestTimer)
			const term = value.split(/[,;]/).pop().trim()
			if (term.length < 2) {
				this.suggestions = []
				return
			}
			this.suggestTimer = setTimeout(async () => {
				try {
					const matches = await autocomplete(term)
					// Contacts may carry several addresses: email can be a
					// string or an array. Normalize to one suggestion per
					// address with a guaranteed string email.
					const seen = new Set()
					this.suggestions = (matches ?? [])
						.flatMap((match) => {
							const emails = Array.isArray(match.email) ? match.email : [match.email]
							return emails
								.filter((email) => typeof email === 'string' && email.includes('@'))
								.map((email) => ({ label: typeof match.label === 'string' ? match.label : email, email }))
						})
						.filter((item) => !seen.has(item.email) && seen.add(item.email))
						.slice(0, 6)
				} catch (error) {
					logger.debug('recipient autocomplete failed', error)
					this.suggestions = []
				}
			}, 250)
		},

		pickSuggestion(match) {
			if (this.suggestions.length === 0) {
				// Already handled (pointerdown and click can both fire)
				return
			}
			clearTimeout(this.hideTimer)
			clearTimeout(this.suggestTimer)
			const field = this.suggestField
			const segments = this[field].split(',')
			segments[segments.length - 1] = String(match.email)
			this[field] = segments.map((segment) => String(segment).trim()).filter(Boolean).join(', ') + ', '
			this.suggestions = []
			// v-for refs are arrays in Vue 2
			const input = this.$refs[field + 'Input']
			;(Array.isArray(input) ? input[0] : input)?.focus()
		},

		hideSuggestionsSoon() {
			this.hideTimer = setTimeout(() => {
				this.suggestions = []
			}, 300)
		},

		pickFile() {
			this.$refs.fileInput.click()
		},

		pickPhoto() {
			this.$refs.photoInput.click()
		},

		async onFiles(event) {
			const files = Array.from(event.target.files ?? [])
			event.target.value = ''
			for (const file of files) {
				if (this.totalBytes + file.size > MAX_TOTAL_BYTES) {
					this.notice = this.t('mail_mobile', '{name} is too large to send by email (limit {limit} MB in total)', {
						name: file.name,
						limit: Math.round(MAX_TOTAL_BYTES / 1024 / 1024),
					}, AS_TEXT)
					continue
				}
				const entry = {
					fileName: file.name,
					size: file.size,
					uploading: true,
					id: null,
				}
				this.attachments.push(entry)
				try {
					const uploaded = await uploadAttachment(file)
					entry.id = uploaded.id
					entry.uploading = false
				} catch (error) {
					logger.error('attachment upload failed', error)
					this.attachments = this.attachments.filter((a) => a !== entry)
					this.notice = this.t('mail_mobile', 'Could not upload {name}', { name: file.name }, AS_TEXT)
				}
			}
		},

		removeAttachment(index) {
			this.attachments.splice(index, 1)
		},

		dropForward() {
			// The inline images only exist to render the quoted body
			this.forwardedHtml = null
			this.forwardedInline = []
		},

		parseRecipients(raw) {
			return raw.split(/[,;\s]+/)
				.map((part) => part.replace(/^<|>$/g, ''))
				.filter((part) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part))
				.map((email) => ({ label: email, email }))
		},

		async send() {
			const to = this.parseRecipients(this.to)
			if (to.length === 0) {
				this.notice = this.t('mail_mobile', 'Please enter at least one valid recipient address')
				return
			}
			if (this.needsSmime && !this.unsignedOk) {
				this.notice = this.t('mail_mobile', 'Tick "Send without signing or encryption" to send this from your phone, or use the full Mail app.')
				return
			}
			this.sending = true
			this.notice = null
			let bodyHtml = null
			let bodyPlain
			if (this.usesHtml) {
				bodyHtml = '<div>' + this.editorHtml + '</div>'
				bodyPlain = signatureToText(this.editorHtml)
			} else {
				bodyPlain = this.body
			}
			if (this.signatureHtml) {
				if (bodyHtml !== null) {
					bodyHtml += '<div>-- </div>' + this.signatureHtml
				}
				bodyPlain += '\n\n-- \n' + signatureToText(this.signatureHtml)
			}
			if (this.forwardedHtml) {
				if (bodyHtml !== null) {
					bodyHtml += '<br>' + this.forwardedHtml
				}
				bodyPlain += '\n\n' + signatureToText(this.forwardedHtml)
			}
			try {
				await sendMessage({
					accountId: this.selectedIdentity?.accountId ?? this.accountId,
					aliasId: this.selectedIdentity?.aliasId ?? null,
					fromEmail: this.selectedIdentity?.email ?? null,
					to,
					cc: this.parseRecipients(this.cc),
					bcc: this.parseRecipients(this.bcc),
					subject: this.subject,
					body: bodyPlain,
					bodyHtml,
					isHtml: this.usesHtml,
					inReplyToMessageId: this.inReplyToMessageId,
					attachments: [
						...this.attachments
							.filter((attachment) => attachment.id !== null && attachment.id !== undefined)
							.map((attachment) => (attachment.type === 'message-attachment'
								? {
										type: 'message-attachment',
										id: attachment.id,
										mailboxId: attachment.mailboxId,
										uid: attachment.uid,
									}
								: { type: 'local', id: attachment.id })),
						...(this.forwardedHtml
							? this.forwardedInline.map((attachment) => ({
									type: 'message-attachment-inline',
									id: attachment.id,
									mailboxId: attachment.mailboxId,
									uid: attachment.uid,
								}))
							: []),
					],
				})
				store.composerPrefill = null
				this.$emit('sent')
			} catch (error) {
				logger.error('could not send message', error)
				this.notice = store.authError
					? this.t('mail_mobile', 'Cannot send: the account cannot sign in to the mail server right now.')
					: this.t('mail_mobile', 'Could not send the message — it may be waiting in the outbox of the full Mail app.')
			} finally {
				this.sending = false
			}
		},
	},
}
</script>

<style scoped>
.composer {
	display: flex;
	flex-direction: column;
	padding: 12px 16px calc(env(safe-area-inset-bottom, 0px) + 16px);
	gap: 10px;
}
.composer__field {
	display: flex;
	align-items: center;
	gap: 10px;
	border-bottom: 1px solid var(--mob-border);
	padding-bottom: 6px;
}
.composer__field--to {
	position: relative;
}
.composer__suggest {
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	z-index: 20;
	background-color: var(--mob-bg);
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	overflow: hidden;
}
.composer__suggest-item {
	display: flex;
	flex-direction: column;
	gap: 1px;
	width: 100%;
	padding: 10px 12px;
	border: none;
	background: transparent;
	color: var(--mob-text);
	text-align: start;
	cursor: pointer;
}
.composer__suggest-item:active {
	background-color: var(--mob-hover);
}
.composer__suggest-label {
	font-size: 14px;
}
.composer__suggest-email {
	font-size: 12px;
	color: var(--mob-text-muted);
}
.composer__label {
	flex: none;
	width: 60px;
	font-size: 13px;
	color: var(--mob-text-muted);
}
.composer__select {
	flex: 1;
	width: 100%;
	margin: 0;
	border: none;
	background: transparent;
	color: var(--mob-text);
	font-size: 15px;
	padding: 8px 0;
	outline: none;
}
.composer__field input {
	flex: 1;
	width: 100%;
	margin: 0;
	border: none;
	border-radius: 0;
	background: transparent;
	color: var(--mob-text);
	font-size: 15px;
	padding: 8px 0;
	outline: none;
}
.composer__body {
	width: 100%;
	margin: 0;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	background: transparent;
	color: var(--mob-text);
	font-family: inherit;
	font-size: 15px;
	padding: 10px;
	resize: vertical;
	min-height: 40vh;
}
.composer__toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	align-items: center;
}
.composer__tool {
	min-width: 40px;
	height: 40px;
	padding: 0 8px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	background: transparent;
	color: var(--mob-text);
	font-size: 16px;
	cursor: pointer;
}
.composer__tool:active {
	background-color: var(--mob-hover);
}
.composer__tool--bold {
	font-weight: 700;
}
.composer__tool--italic {
	font-style: italic;
}
.composer__tool--underline {
	text-decoration: underline;
}
.composer__tool-sep {
	width: 1px;
	height: 24px;
	background-color: var(--mob-border);
	margin: 0 4px;
}
.composer__body--rich {
	overflow-y: auto;
}
.composer__body--rich:empty::before {
	content: attr(data-placeholder);
	color: var(--mob-text-muted);
	pointer-events: none;
}
.composer__sigrow {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 10px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	font-size: 14px;
}
.composer__sigrow-status {
	flex: 1;
	color: var(--mob-text-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.composer__sigselect {
	flex: none;
	max-width: 55%;
	border: none;
	background: transparent;
	color: var(--mob-accent);
	font-size: 14px;
	padding: 4px;
}
.composer__ccbcc {
	align-self: flex-start;
	border: none;
	background: transparent;
	color: var(--mob-accent);
	font-size: 14px;
	padding: 2px 0;
	cursor: pointer;
}
.composer__forwarded {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 10px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	font-size: 14px;
	color: var(--mob-text-muted);
	background-color: var(--mob-hover);
}
.composer__forwarded span {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
}
.composer__forwarded-remove {
	flex: none;
	border: none;
	background: transparent;
	color: var(--mob-text-muted);
	font-size: 18px;
	line-height: 1;
	padding: 0 4px;
	cursor: pointer;
}
.composer__attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.composer__attachment {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 6px 10px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	font-size: 13px;
	background-color: var(--mob-hover);
}
.composer__attachment-remove {
	border: none;
	background: transparent;
	color: var(--mob-text-muted);
	font-size: 16px;
	cursor: pointer;
	padding: 0 2px;
}
.composer__notice {
	padding: 10px;
	border-radius: var(--mob-radius);
	background-color: var(--mob-hover);
	color: var(--mob-danger);
	font-size: 14px;
}
.composer__smime {
	color: var(--mob-text);
}
.composer__smime p {
	margin: 0 0 8px;
}
.composer__actions {
	display: flex;
	gap: 8px;
}
.composer__btn {
	padding: 12px 14px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	background: transparent;
	color: var(--mob-text);
	font-size: 14px;
	cursor: pointer;
}
.composer__btn--send {
	flex: 1;
	background-color: var(--mob-accent);
	border-color: var(--mob-accent);
	color: var(--mob-accent-text);
	font-weight: 600;
}
.composer__btn--send:disabled {
	opacity: 0.6;
}
</style>
