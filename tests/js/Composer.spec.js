/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Composer from '../../src/views/Composer.vue'

vi.mock('../../src/api/mail.js', () => ({
	autocomplete: vi.fn().mockResolvedValue([]),
	sendMessage: vi.fn(),
	uploadAttachment: vi.fn(),
}))

vi.mock('../../src/store.js', () => ({
	store: {
		accounts: [{
			id: 1,
			emailAddress: 'me@example.com',
			signature: '<p>Jane Doe</p><p>Example Org<br>+1 555 0100</p>',
			aliases: [{
				id: 7,
				name: 'Support',
				alias: 'support@example.com',
				signature: '<p>Example Support</p>',
			}],
		}],
		composerPrefill: null,
		authError: null,
	},
}))

describe('mobile Composer recipient suggestions', () => {
	let wrapper

	beforeEach(() => {
		wrapper = shallowMount(Composer, {
			mocks: {
				t: (app, text) => text,
			},
		})
	})

	it('defaults the signature to the account and lists selectable signatures', () => {
		expect(wrapper.vm.body).toBe('')
		expect(wrapper.vm.signatureHtml).toBe('<p>Jane Doe</p><p>Example Org<br>+1 555 0100</p>')
		expect(wrapper.vm.signatureOptions.map((o) => o.email)).toContain('me@example.com')
	})

	it('can switch to no signature', async () => {
		await wrapper.setData({ signatureKey: 'none' })
		expect(wrapper.vm.signatureHtml).toBe(null)
	})

	it('sends the rich editor HTML with the signature and a plain-text alternative', async () => {
		const { sendMessage } = await import('../../src/api/mail.js')
		await wrapper.setData({ to: 'a@b.example', editorHtml: 'Hi <b>there</b><br>second line' })

		await wrapper.vm.send()

		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
			isHtml: true,
			bodyHtml: '<div>Hi <b>there</b><br>second line</div>'
				+ '<div>-- </div><p>Jane Doe</p><p>Example Org<br>+1 555 0100</p>',
			body: 'Hi there\nsecond line\n\n-- \nJane Doe\nExample Org\n+1 555 0100',
			aliasId: null,
		}))
	})

	it('sends cc and bcc recipients', async () => {
		const { sendMessage } = await import('../../src/api/mail.js')
		await wrapper.setData({
			to: 'a@b.example',
			showCcBcc: true,
			cc: 'carbon@b.example, second@b.example',
			bcc: 'blind@b.example',
		})

		await wrapper.vm.send()

		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
			to: [{ label: 'a@b.example', email: 'a@b.example' }],
			cc: [
				{ label: 'carbon@b.example', email: 'carbon@b.example' },
				{ label: 'second@b.example', email: 'second@b.example' },
			],
			bcc: [{ label: 'blind@b.example', email: 'blind@b.example' }],
		}))
	})

	it('forwards the original message and its attachments', async () => {
		const { store } = await import('../../src/store.js')
		const { sendMessage } = await import('../../src/api/mail.js')
		store.composerPrefill = {
			accountId: 1,
			subject: 'Fwd: Invoice',
			forwardedHtml: '<div>---------- Forwarded message ----------</div><p>Original body</p>',
			forwardedFrom: 'Alice',
			attachments: [{ type: 'message-attachment', id: '2', mailboxId: 5, uid: 42, fileName: 'invoice.pdf', size: 1000 }],
		}
		const forwarding = shallowMount(Composer, { mocks: { t: (app, text) => text } })
		store.composerPrefill = null
		await forwarding.setData({ to: 'x@y.example', editorHtml: 'FYI' })

		await forwarding.vm.send()

		const payload = sendMessage.mock.calls.at(-1)[0]
		expect(payload.subject).toBe('Fwd: Invoice')
		expect(payload.attachments).toEqual([{ type: 'message-attachment', id: '2', mailboxId: 5, uid: 42 }])
		expect(payload.bodyHtml).toContain('<p>Original body</p>')
		expect(payload.body).toContain('Original body')
	})

	it('carries the inline images of the forwarded body', async () => {
		const { store } = await import('../../src/store.js')
		const { sendMessage } = await import('../../src/api/mail.js')
		store.composerPrefill = {
			accountId: 1,
			forwardedHtml: '<p>Body</p><img src="/x" data-cid="logo@example">',
			attachments: [{ type: 'message-attachment', id: '2', mailboxId: 5, uid: 42 }],
			inlineAttachments: [{ type: 'message-attachment-inline', id: '3', mailboxId: 5, uid: 42, fileName: 'logo.png' }],
		}
		const forwarding = shallowMount(Composer, { mocks: { t: (app, text) => text } })
		store.composerPrefill = null
		await forwarding.setData({ to: 'x@y.example', editorHtml: 'FYI' })

		await forwarding.vm.send()

		const payload = sendMessage.mock.calls.at(-1)[0]
		expect(payload.attachments).toEqual([
			{ type: 'message-attachment', id: '2', mailboxId: 5, uid: 42 },
			{ type: 'message-attachment-inline', id: '3', mailboxId: 5, uid: 42 },
		])
		// data-cid survives so the MIME builder can rebuild the cid: reference
		expect(payload.bodyHtml).toContain('data-cid="logo@example"')
	})

	it('shows only real attachments as chips, not the inline images', async () => {
		const { store } = await import('../../src/store.js')
		store.composerPrefill = {
			accountId: 1,
			forwardedHtml: '<p>Body</p>',
			attachments: [{ type: 'message-attachment', id: '2', mailboxId: 5, uid: 42, fileName: 'q.pdf' }],
			inlineAttachments: [{ type: 'message-attachment-inline', id: '3', mailboxId: 5, uid: 42, fileName: 'logo.png' }],
		}
		const forwarding = shallowMount(Composer, { mocks: { t: (app, text) => text } })
		store.composerPrefill = null

		expect(forwarding.vm.attachments.map((attachment) => attachment.fileName)).toEqual(['q.pdf'])
	})

	it('drops the quoted original and its inline images when the forward is removed', async () => {
		const { store } = await import('../../src/store.js')
		const { sendMessage } = await import('../../src/api/mail.js')
		store.composerPrefill = {
			accountId: 1,
			forwardedHtml: '<p>Original body</p>',
			attachments: [],
			inlineAttachments: [{ type: 'message-attachment-inline', id: '3', mailboxId: 5, uid: 42 }],
		}
		const forwarding = shallowMount(Composer, { mocks: { t: (app, text) => text } })
		store.composerPrefill = null
		await forwarding.setData({ to: 'x@y.example', editorHtml: 'FYI' })

		forwarding.vm.dropForward()
		await forwarding.vm.send()

		const payload = sendMessage.mock.calls.at(-1)[0]
		expect(payload.bodyHtml).not.toContain('Original body')
		expect(payload.attachments).toEqual([])
	})

	it('hides cc and bcc until they are asked for', () => {
		expect(wrapper.vm.recipientFields.map((field) => field.key)).toEqual(['to'])

		wrapper.vm.showCcBcc = true

		expect(wrapper.vm.recipientFields.map((field) => field.key)).toEqual(['to', 'cc', 'bcc'])
	})

	it('picks a suggestion into the field that is being edited', async () => {
		await wrapper.setData({ showCcBcc: true, cc: 'joh', suggestField: 'cc', suggestions: [{ label: 'John', email: 'john@doe.example' }] })

		wrapper.vm.pickSuggestion({ label: 'John', email: 'john@doe.example' })

		expect(wrapper.vm.cc).toBe('john@doe.example, ')
		expect(wrapper.vm.to).toBe('')
	})

	it('inserts emoji into the rich editor via the execCommand fallback', () => {
		// Stub the contenteditable element: jsdom execCommand is a no-op,
		// so this exercises the innerHTML fallback + onEditorInput readback.
		wrapper.vm.$refs.editor = {
			innerHTML: 'Hi ',
			focus() {},
		}
		wrapper.vm.insertEmoji('🙂')
		expect(wrapper.vm.editorHtml).toBe('Hi 🙂')
	})

	it('inserts emoji at the cursor in plain-text mode', async () => {
		const { store } = await import('../../src/store.js')
		store.accounts[0].editorMode = 'plaintext'
		const plainWrapper = shallowMount(Composer, { mocks: { t: (app, text) => text } })
		await plainWrapper.setData({ body: 'Hi' })
		const el = plainWrapper.find('textarea').element
		el.selectionStart = el.selectionEnd = 2

		plainWrapper.vm.insertEmoji('🤷')
		expect(plainWrapper.vm.body).toBe('Hi🤷')
		store.accounts[0].editorMode = undefined
	})

	it('offers the account and its aliases as sender identities', () => {
		expect(wrapper.vm.identities.map((identity) => identity.email))
			.toEqual(['me@example.com', 'support@example.com'])
	})

	it('can pick a specific signature from the selector', async () => {
		await wrapper.setData({ body: 'Hello!', signatureKey: 'l7' })

		expect(wrapper.vm.signatureHtml).toBe('<p>Example Support</p>')
		expect(wrapper.vm.body).toBe('Hello!')
	})

	it('follows the sender identity with its own signature', async () => {
		await wrapper.setData({ identityKey: 'l7' })

		wrapper.vm.onIdentityChange()

		expect(wrapper.vm.signatureKey).toBe('l7')
		expect(wrapper.vm.signatureHtml).toBe('<p>Example Support</p>')
	})

	it('keeps an explicitly picked signature when the sender changes', async () => {
		await wrapper.setData({ signatureKey: 'none', signatureChosen: true, identityKey: 'l7' })

		wrapper.vm.onIdentityChange()

		expect(wrapper.vm.signatureKey).toBe('none')
		expect(wrapper.vm.signatureHtml).toBe(null)
	})

	it('inserts a picked suggestion into the To field', async () => {
		await wrapper.setData({
			to: 'joh',
			suggestions: [{ label: 'John Doe', email: 'john@example.com' }],
		})

		const item = wrapper.find('.composer__suggest-item')
		expect(item.exists()).toBe(true)

		await item.trigger('pointerdown')

		expect(wrapper.vm.to).toBe('john@example.com, ')
		expect(wrapper.vm.suggestions).toEqual([])
		// and the DOM input actually shows it
		expect(wrapper.find('input[inputmode="email"]').element.value).toBe('john@example.com, ')
	})

	it('is idempotent when pointerdown and click both fire', async () => {
		await wrapper.setData({
			to: 'joh',
			suggestions: [{ label: 'John', email: 'john@example.com' }],
		})

		const item = wrapper.find('.composer__suggest-item')
		await item.trigger('pointerdown')
		// the same element also dispatches a click in some browsers
		await item.trigger('click')

		expect(wrapper.vm.to).toBe('john@example.com, ')
	})

	it('handles contacts whose email is an array (live regression)', async () => {
		const { autocomplete } = await import('../../src/api/mail.js')
		autocomplete.mockResolvedValueOnce([
			{ label: 'Sam Carter', email: ['sam@one.example', 'sam@two.example'] },
			{ label: 'Broken', email: null },
		])

		wrapper.vm.onRecipientInput('to', 'sam')
		await new Promise((resolve) => setTimeout(resolve, 300))

		expect(wrapper.vm.suggestions).toEqual([
			{ label: 'Sam Carter', email: 'sam@one.example' },
			{ label: 'Sam Carter', email: 'sam@two.example' },
		])

		wrapper.vm.pickSuggestion(wrapper.vm.suggestions[1])
		expect(wrapper.vm.to).toBe('sam@two.example, ')
	})

	it('sends plain text when the account writing mode is plaintext', async () => {
		const { sendMessage } = await import('../../src/api/mail.js')
		const { store } = await import('../../src/store.js')
		store.accounts[0].editorMode = 'plaintext'
		// mount fresh so usesHtml is evaluated with the plaintext setting
		const plainWrapper = shallowMount(Composer, { mocks: { t: (app, text) => text } })
		await plainWrapper.setData({ to: 'a@b.example', body: 'Hi' })

		await plainWrapper.vm.send()

		expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
			isHtml: false,
			bodyHtml: null,
			body: 'Hi\n\n-- \nJane Doe\nExample Org\n+1 555 0100',
		}))
		store.accounts[0].editorMode = undefined
	})

	it('appends after an existing complete recipient', async () => {
		await wrapper.setData({
			to: 'first@example.com, joh',
			suggestions: [{ label: 'John', email: 'john@example.com' }],
		})

		await wrapper.find('.composer__suggest-item').trigger('pointerdown')

		expect(wrapper.vm.to).toBe('first@example.com, john@example.com, ')
	})

	it('never sends unsigned without asking when the sender has an S/MIME certificate', async () => {
		const { sendMessage } = await import('../../src/api/mail.js')
		const { store } = await import('../../src/store.js')
		sendMessage.mockClear()
		store.accounts[0].smimeCertificateId = 3
		const signedWrapper = shallowMount(Composer, { mocks: { t: (app, text) => text } })
		await signedWrapper.setData({ to: 'a@b.example', editorHtml: 'Hi' })

		expect(signedWrapper.find('.composer__smime').exists()).toBe(true)
		await signedWrapper.vm.send()
		expect(sendMessage).not.toHaveBeenCalled()
		expect(signedWrapper.vm.notice).toContain('Send without signing or encryption')

		await signedWrapper.setData({ unsignedOk: true })
		await signedWrapper.vm.send()
		expect(sendMessage).toHaveBeenCalledTimes(1)
		store.accounts[0].smimeCertificateId = undefined
	})

	it('asks nothing for a sender without a certificate', () => {
		expect(wrapper.find('.composer__smime').exists()).toBe(false)
	})
})
