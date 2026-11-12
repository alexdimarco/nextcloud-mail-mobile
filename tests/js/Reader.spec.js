/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Reader from '../../src/views/Reader.vue'

const message = {
	accountId: 1,
	mailboxId: 2,
	uid: 42,
	messageId: '<abc@example.com>',
	subject: 'Quarterly numbers',
	from: [{ label: 'Alice', email: 'alice@example.com' }],
	to: [{ label: 'Me', email: 'me@example.com' }, { label: 'Bob', email: 'bob@example.com' }],
	cc: [{ label: 'Carol', email: 'carol@example.com' }, { email: 'support@example.com' }],
	body: '<p>Numbers</p><img src="https://cloud.example/apps/mail/img/1" data-cid="logo@example">',
	hasHtmlBody: true,
	dateInt: 1700000000,
	attachments: [{ id: '2', fileName: 'q.pdf', size: 1024 }],
	inlineAttachments: [{ id: '3', fileName: 'logo.png', size: 512, cid: 'logo@example' }],
}

vi.mock('../../src/api/mail.js', () => ({
	fetchMessage: vi.fn(),
	setFlags: vi.fn(),
	deleteMessage: vi.fn(),
	htmlBodyUrl: (id) => `/html/${id}`,
}))

vi.mock('../../src/store.js', () => ({
	store: {
		accounts: [{
			id: 1,
			emailAddress: 'me@example.com',
			aliases: [{ id: 7, alias: 'support@example.com' }],
		}],
		currentEnvelope: null,
		authError: null,
	},
	accountFor: () => ({ trashMailboxId: 3 }),
	findMailbox: () => ({ databaseId: 2, accountId: 1 }),
}))

describe('mobile Reader reply and forward', () => {
	let wrapper

	beforeEach(async () => {
		const { fetchMessage } = await import('../../src/api/mail.js')
		fetchMessage.mockResolvedValue({ ...message })
		wrapper = shallowMount(Reader, {
			propsData: { messageId: 9 },
			mocks: { t: (app, text) => text },
		})
		await wrapper.vm.$nextTick()
		await wrapper.vm.$nextTick()
	})

	it('replies to the sender only', () => {
		wrapper.vm.reply()

		expect(wrapper.emitted('reply')[0][0]).toMatchObject({
			to: [{ label: 'Alice', email: 'alice@example.com' }],
			subject: 'Re: Quarterly numbers',
			inReplyToMessageId: '<abc@example.com>',
		})
		expect(wrapper.emitted('reply')[0][0].cc).toBeUndefined()
	})

	it('replies to all, dropping our own account and alias addresses', () => {
		wrapper.vm.replyAll()

		expect(wrapper.emitted('reply')[0][0]).toMatchObject({
			to: [
				{ label: 'Alice', email: 'alice@example.com' },
				{ label: 'Bob', email: 'bob@example.com' },
			],
			cc: [{ label: 'Carol', email: 'carol@example.com' }],
			subject: 'Re: Quarterly numbers',
		})
	})

	it('renders the reply all and forward buttons', () => {
		const labels = wrapper.findAll('.reader__action').wrappers.map((button) => button.text())

		expect(labels).toContain('Reply all')
		expect(labels).toContain('Forward')
	})

	it('offers reply all only when it reaches more than one person', async () => {
		expect(wrapper.vm.canReplyAll).toBe(true)

		await wrapper.setData({
			message: { ...message, to: [{ label: 'Me', email: 'me@example.com' }], cc: [] },
		})

		expect(wrapper.vm.canReplyAll).toBe(false)
	})

	it('forwards the body with both regular and inline attachments', () => {
		wrapper.vm.forward()

		const payload = wrapper.emitted('forward')[0][0]
		expect(payload.subject).toBe('Fwd: Quarterly numbers')
		expect(payload.to).toEqual([])
		expect(payload.forwardedHtml).toContain('Forwarded message')
		expect(payload.forwardedHtml).toContain('data-cid="logo@example"')
		expect(payload.attachments).toEqual([
			{ type: 'message-attachment', id: '2', mailboxId: 2, uid: 42, fileName: 'q.pdf', size: 1024 },
		])
		expect(payload.inlineAttachments).toEqual([
			{ type: 'message-attachment-inline', id: '3', mailboxId: 2, uid: 42, fileName: 'logo.png', size: 512 },
		])
	})

	it('escapes the forward header instead of injecting markup', async () => {
		await wrapper.setData({
			message: { ...message, subject: '<script>alert(1)</script>' },
		})

		wrapper.vm.forward()

		expect(wrapper.emitted('forward')[0][0].forwardedHtml).toContain('&lt;script&gt;')
	})
})
