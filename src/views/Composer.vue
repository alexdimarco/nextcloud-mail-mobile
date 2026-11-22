<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<form class="composer" @submit.prevent="send">
		<!-- Always shown, so the sender is never a surprise. The last choice
			adds another address to send from. -->
		<label v-if="identities.length" class="composer__field">
			<span class="composer__label">{{ t('mail_mobile', 'From') }}</span>
			<span class="composer__select-wrap">
				<select v-model="fromChoice" class="composer__select">
					<option
						v-for="identity in identities"
						:key="identity.key"
						:value="identity.key">
						{{ identityLabel(identity) }}
					</option>
					<option v-if="ownAccounts.length" :value="ADD_ADDRESS">
						{{ t('mail_mobile', 'Add an address …') }}
					</option>
				</select>
			</span>
		</label>
		<div v-if="addingAddress" class="composer__newaddr">
			<!-- Enter adds the address; it must never send the message -->
			<label class="composer__field">
				<span class="composer__label">{{ t('mail_mobile', 'Address') }}</span>
				<input
					ref="newAddressInput"
					v-model="newAddress"
					type="email"
					inputmode="email"
					autocapitalize="off"
					autocomplete="off"
					:placeholder="t('mail_mobile', 'name@example.com')"
					@keydown.enter.prevent="addAddress">
			</label>
			<label class="composer__field">
				<span class="composer__label">{{ t('mail_mobile', 'Name') }}</span>
				<input
					v-model="newAddressName"
					type="text"
					autocomplete="off"
					:placeholder="t('mail_mobile', 'Shown with the address')"
					@keydown.enter.prevent="addAddress">
			</label>
			<label v-if="ownAccounts.length > 1" class="composer__field">
				<span class="composer__label">{{ t('mail_mobile', 'Account') }}</span>
				<span class="composer__select-wrap">
					<select v-model="newAddressAccountId" class="composer__select">
						<option
							v-for="account in ownAccounts"
							:key="account.id"
							:value="account.id">
							{{ account.emailAddress }}
						</option>
					</select>
				</span>
			</label>
			<p class="composer__newaddr-hint">
				{{ t('mail_mobile', 'Mail will send from it through {account}. Your mail server must allow that account to send from this address.', { account: newAddressAccount ? newAddressAccount.emailAddress : '' }, AS_TEXT) }}
			</p>
			<div v-if="addressNotice" class="composer__notice">
				{{ addressNotice }}
			</div>
			<div class="composer__newaddr-actions">
				<button type="button" class="composer__btn" @click="cancelAddAddress">
					{{ t('mail_mobile', 'Cancel') }}
				</button>
				<button
					type="button"
					class="composer__btn composer__btn--send"
					:disabled="savingAddress"
					@click="addAddress">
					{{ savingAddress ? t('mail_mobile', 'Adding …') : t('mail_mobile', 'Add address') }}
				</button>
			</div>
		</div>
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
import { autocomplete, createAlias, sendMessage, uploadAttachment } from '../api/mail.js'
import { cleanEditorHtml, forgetDraft, keepDraft } from '../draft.js'
import { AS_TEXT } from '../l10nText.js'
import logger from '../logger.js'
import { store } from '../store.js'

// Keep well below common SMTP message-size limits (encoding adds ~35%)
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

// The From list's last choice: add another address to send from. Real
// choices are 'a' or 'l' followed by a number, so this cannot clash.
const ADD_ADDRESS = '+add'

// The same test the recipient fields use
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

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
		// A message kept while the page reloaded (see draft.js)
		const kept = prefill.kept ?? null
		const source = kept ?? prefill
		const accountId = source.accountId ?? store.accounts[0]?.id
		const identities = buildIdentities(store.accounts)
		// A reply or forward starts from the alias the mail was sent to;
		// anything else, or an alias since removed, from the account itself
		const initial = (kept && identities.find((identity) => identity.key === kept.identityKey))
			?? identities.find((identity) => identity.accountId === accountId && identity.aliasId === (prefill.aliasId ?? null))
			?? identities.find((identity) => identity.accountId === accountId && identity.aliasId === null)
			?? identities[0]
		const addresses = (recipients) => (recipients ?? []).map((recipient) => recipient.email).join(', ')
		const to = kept ? String(kept.to ?? '') : addresses(prefill.to)
		const cc = kept ? String(kept.cc ?? '') : addresses(prefill.cc)
		const bcc = kept ? String(kept.bcc ?? '') : addresses(prefill.bcc)
		const subject = String(source.subject ?? '')
		// Forwarded attachments are references the server resolves; local
		// uploads are added with an id by onFiles()
		const attachments = (source.attachments ?? []).map((attachment) => ({ ...attachment, uploading: false }))
		return {
			accountId,
			identityKey: initial?.key ?? null,
			signatureKey: kept?.signatureKey ?? (initial?.signature ? initial.key : 'none'),
			signatureChosen: kept?.signatureChosen ?? false,
			to,
			cc,
			bcc,
			showCcBcc: cc !== '' || bcc !== '',
			subject,
			inReplyToMessageId: source.inReplyToMessageId ?? null,
			forwardedHtml: source.forwardedHtml ?? null,
			forwardedFrom: source.forwardedFrom ?? '',
			// Images embedded in the forwarded body: not shown as chips, they
			// are part of the quoted message and travel with it
			forwardedInline: (kept ? kept.forwardedInline : prefill.inlineAttachments) ?? [],
			body: kept ? String(kept.body ?? '') : '',
			editorHtml: kept ? cleanEditorHtml(kept.editorHtml) : '',
			emojis: ['🙂', '😂', '😢', '😭', '🤷', '👍', '❤️', '🎉'],
			attachments,
			// How the message was when opened: leaving it unchanged loses
			// nothing, so it needs no question. A kept message always counts.
			restored: kept !== null,
			opened: JSON.stringify([to, cc, bcc, subject, attachments.length]),
			// Sent, or the person chose to discard it: nothing left to keep
			sent: false,
			discarded: false,
			sending: false,
			// The sender has an S/MIME certificate and the person agreed to
			// send this message unsigned anyway
			unsignedOk: false,
			notice: null,
			AS_TEXT,
			ADD_ADDRESS,
			// The "Add an address" form under the From line
			addingAddress: false,
			newAddress: '',
			newAddressName: '',
			newAddressAccountId: null,
			savingAddress: false,
			addressNotice: null,
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

		// Addresses are added only to the person's own accounts, never to
		// one someone shared with them (Mail would allow it, changing the
		// owner's account)
		ownAccounts() {
			return store.accounts.filter((account) => !account.isDelegated)
		},

		// What the From list shows: the sender, or "Add an address" for a
		// moment when that is picked
		fromChoice: {
			get() {
				return this.identityKey
			},

			set(value) {
				if (value === ADD_ADDRESS) {
					this.openAddAddress()
					// Show the current sender again until a new address exists
					this.$forceUpdate()
					return
				}
				this.pickIdentity(value)
			},
		},

		identities() {
			return buildIdentities(store.accounts)
		},

		newAddressAccount() {
			return this.ownAccounts.find((account) => account.id === this.newAddressAccountId) ?? null
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

		// Whether leaving now would lose something the person did: text
		// typed, a recipient or the subject changed, a file attached or
		// removed. The page asks before throwing that away.
		hasWork() {
			if (this.sent || this.discarded) {
				return false
			}
			if (this.restored) {
				return true
			}
			const typed = (this.body + signatureToText(this.editorHtml)).trim()
			return typed !== ''
				|| JSON.stringify([this.to, this.cc, this.bcc, this.subject, this.attachments.length]) !== this.opened
		},
	},

	created() {
		const kept = store.composerPrefill?.kept
		if (!kept) {
			return
		}
		store.composerPrefill = null
		const waiting = kept.uploadingNames ?? []
		this.notice = waiting.length > 0
			? this.t('mail_mobile', 'Your message was kept while the page reloaded. Attach {files} again: it was still uploading.', { files: waiting.join(', ') }, AS_TEXT)
			: this.t('mail_mobile', 'Your message was kept while the page reloaded.')
	},

	mounted() {
		window.addEventListener('pagehide', this.keepForReload)
		// Back from the back-forward cache with the message still on
		// screen: the copy kept as the page went away is not needed
		window.addEventListener('pageshow', forgetDraft)
		if (this.editorHtml && this.$refs.editor) {
			// Cleaned in data(): plain formatting only
			this.$refs.editor.innerHTML = this.editorHtml
		} else if (this.editorHtml && !this.body) {
			// Kept from the rich editor, and the account now writes plain text
			this.body = signatureToText(this.editorHtml)
		}
	},

	beforeDestroy() {
		window.removeEventListener('pagehide', this.keepForReload)
		window.removeEventListener('pageshow', forgetDraft)
		clearTimeout(this.suggestTimer)
		clearTimeout(this.hideTimer)
	},

	methods: {
		// The page is going away (reloading to sign in again, or to an
		// updated version): keep the message so it comes back afterwards
		keepForReload() {
			if (!this.hasWork) {
				return
			}
			keepDraft({
				accountId: this.accountId,
				identityKey: this.identityKey,
				signatureKey: this.signatureKey,
				signatureChosen: this.signatureChosen,
				to: this.to,
				cc: this.cc,
				bcc: this.bcc,
				subject: this.subject,
				body: this.body,
				editorHtml: this.editorHtml,
				inReplyToMessageId: this.inReplyToMessageId,
				forwardedHtml: this.forwardedHtml,
				forwardedFrom: this.forwardedFrom,
				forwardedInline: this.forwardedInline,
				// Files already uploaded to Mail keep their place; one still
				// uploading is named, to attach again
				attachments: this.attachments
					.filter((attachment) => !attachment.uploading && attachment.id !== null && attachment.id !== undefined),
				uploadingNames: this.attachments.filter((attachment) => attachment.uploading).map((attachment) => attachment.fileName),
			})
		},

		// The person chose to throw the message away
		discard() {
			this.discarded = true
			forgetDraft()
		},

		identityLabel(identity) {
			if (!identity) {
				return ''
			}
			return identity.name ? `${identity.name} <${identity.email}>` : identity.email
		},

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

		pickIdentity(key) {
			this.identityKey = key
			this.onIdentityChange()
		},

		onIdentityChange() {
			// Sending as another identity should attach that identity's
			// signature — unless the user picked one explicitly
			if (this.signatureChosen) {
				return
			}
			this.signatureKey = this.selectedIdentity?.signature ? this.selectedIdentity.key : 'none'
		},

		openAddAddress() {
			// Through the account now sending, with its name; the first own
			// account when that one was shared with the person
			const account = this.ownAccounts.find((candidate) => candidate.id === this.selectedIdentity?.accountId)
				?? this.ownAccounts[0]
			this.newAddressAccountId = account?.id ?? null
			this.newAddressName = account?.name ?? ''
			this.newAddress = ''
			this.addressNotice = null
			this.addingAddress = true
			this.$nextTick(() => this.$refs.newAddressInput?.focus())
		},

		cancelAddAddress() {
			this.addingAddress = false
			this.addressNotice = null
		},

		async addAddress() {
			if (this.savingAddress) {
				return
			}
			const email = this.newAddress.trim()
			if (!EMAIL_PATTERN.test(email)) {
				this.addressNotice = this.t('mail_mobile', 'Enter a full email address, like name@example.com')
				return
			}
			// Already one of the person's addresses: pick it. Mail would
			// store a second copy rather than refuse it.
			const existing = this.identities.find((identity) => identity.email?.toLowerCase() === email.toLowerCase())
			if (existing) {
				this.pickIdentity(existing.key)
				this.addingAddress = false
				return
			}
			const account = this.newAddressAccount
			if (!account) {
				return
			}
			this.savingAddress = true
			this.addressNotice = null
			try {
				const alias = await createAlias(account.id, email, this.newAddressName.trim())
				// The rest of the page (the From list, replies) reads the
				// aliases from the store: add it there, as a reload would
				this.$set(account, 'aliases', [...(account.aliases ?? []), alias])
				this.pickIdentity('l' + alias.id)
				this.addingAddress = false
			} catch (error) {
				logger.error('could not add an address to send from', error)
				this.addressNotice = this.t('mail_mobile', 'Could not add {address}. Try again, or add it in the full Mail app.', { address: email }, AS_TEXT)
			} finally {
				this.savingAddress = false
			}
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
				this.sent = true
				forgetDraft()
				this.$emit('sent')
			} catch (error) {
				logger.error('could not send message', error)
				if (store.authError) {
					this.notice = this.t('mail_mobile', 'Cannot send: the account cannot sign in to the mail server right now.')
				} else if (store.offline) {
					// It may have reached Mail before the connection dropped
					this.notice = this.t('mail_mobile', 'No answer from the server. The message may still go out: look in Sent before sending it again.')
				} else {
					this.notice = this.t('mail_mobile', 'Could not send the message — it may be waiting in the outbox of the full Mail app.')
				}
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
/* The sender list looks like something to tap: a box with a down arrow */
.composer__select-wrap {
	position: relative;
	flex: 1;
	min-width: 0;
}
.composer__select-wrap::after {
	content: '';
	position: absolute;
	right: 14px;
	top: 50%;
	width: 7px;
	height: 7px;
	border-right: 2px solid var(--mob-text-muted);
	border-bottom: 2px solid var(--mob-text-muted);
	transform: translateY(-70%) rotate(45deg);
	pointer-events: none;
}
.composer__select {
	width: 100%;
	min-height: 40px;
	margin: 0;
	padding: 8px 36px 8px 10px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	background: var(--mob-bg);
	color: var(--mob-text);
	font-family: inherit;
	font-size: 15px;
	text-overflow: ellipsis;
	appearance: none;
	-webkit-appearance: none;
	cursor: pointer;
}
.composer__select:focus-visible {
	outline: 2px solid var(--mob-accent);
	outline-offset: 1px;
}
/* The "Add an address" form, set apart from the message fields */
.composer__newaddr {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px 12px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	background-color: var(--mob-hover);
}
.composer__newaddr-hint {
	margin: 0;
	font-size: 13px;
	color: var(--mob-text-muted);
}
.composer__newaddr-actions {
	display: flex;
	gap: 8px;
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
