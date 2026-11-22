/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Reader from '../../src/views/Reader.vue'
import { forgetEverything, recallMessage } from '../../src/memory.js'
import { l10nMocks } from './l10n.js'

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
		}, {
			id: 2,
			emailAddress: 'other@example.org',
			aliases: [{ id: 8, alias: 'sales@example.org' }],
		}],
		currentEnvelope: null,
		authError: null,
		offline: false,
	},
	accountFor: () => ({ trashMailboxId: 3 }),
	findMailbox: () => ({ databaseId: 2, accountId: 1 }),
}))

describe('mobile Reader reply and forward', () => {
	let wrapper

	beforeEach(async () => {
		forgetEverything()
		const { fetchMessage } = await import('../../src/api/mail.js')
		fetchMessage.mockResolvedValue({ ...message })
		wrapper = shallowMount(Reader, {
			propsData: { messageId: 9 },
			mocks: l10nMocks,
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

describe('mobile Reader answers from the address the mail was sent to', () => {
	let wrapper

	async function open(fields) {
		forgetEverything()
		const { fetchMessage } = await import('../../src/api/mail.js')
		fetchMessage.mockResolvedValue({ ...message, ...fields })
		wrapper = shallowMount(Reader, {
			propsData: { messageId: 9 },
			mocks: l10nMocks,
		})
		await wrapper.vm.$nextTick()
		await wrapper.vm.$nextTick()
	}

	it('replies from the alias the mail was sent to', async () => {
		await open({ to: [{ email: 'support@example.com' }], cc: [] })

		wrapper.vm.reply()

		expect(wrapper.emitted('reply')[0][0]).toMatchObject({ accountId: 1, aliasId: 7 })
	})

	it('replies from the account itself when the mail was sent to its main address', async () => {
		// To has the main address first, Cc the alias: the main address wins
		await open({})

		wrapper.vm.reply()

		expect(wrapper.emitted('reply')[0][0].aliasId).toBe(null)
	})

	it('finds the alias in Cc', async () => {
		await open({ to: [{ email: 'bob@example.com' }], cc: [{ email: 'support@example.com' }] })

		wrapper.vm.reply()

		expect(wrapper.emitted('reply')[0][0].aliasId).toBe(7)
	})

	it('matches the alias whatever its letter case', async () => {
		await open({ to: [{ email: 'Support@Example.COM' }], cc: [] })

		wrapper.vm.reply()

		expect(wrapper.emitted('reply')[0][0].aliasId).toBe(7)
	})

	it('never picks an alias of another account', async () => {
		// The mail sits in account 1; sending as account 2's alias through
		// account 1 would be refused or go out from the wrong server
		await open({ to: [{ email: 'sales@example.org' }], cc: [] })

		wrapper.vm.reply()

		expect(wrapper.emitted('reply')[0][0]).toMatchObject({ accountId: 1, aliasId: null })
	})

	it('uses the account itself when none of its addresses is visible (Bcc)', async () => {
		await open({ to: [{ email: 'list@lists.example.net' }], cc: [] })

		wrapper.vm.reply()

		expect(wrapper.emitted('reply')[0][0].aliasId).toBe(null)
	})

	it('replies to all and forwards from the alias too', async () => {
		await open({ to: [{ email: 'support@example.com' }, { email: 'bob@example.com' }], cc: [] })

		wrapper.vm.replyAll()
		wrapper.vm.forward()

		expect(wrapper.emitted('reply')[0][0].aliasId).toBe(7)
		expect(wrapper.emitted('forward')[0][0].aliasId).toBe(7)
	})
})

describe('mobile Reader on a slow or dead connection', () => {
	let api
	let store

	async function mountReader(messageId) {
		const wrapper = shallowMount(Reader, { propsData: { messageId }, mocks: l10nMocks })
		for (let i = 0; i < 4; i++) {
			await Promise.resolve()
		}
		await wrapper.vm.$nextTick()
		return wrapper
	}

	beforeEach(async () => {
		forgetEverything()
		api = await import('../../src/api/mail.js')
		;({ store } = await import('../../src/store.js'))
		api.fetchMessage.mockReset()
		store.offline = false
	})

	it('shows a message opened earlier in the visit at once, before Mail answers', async () => {
		api.fetchMessage.mockResolvedValueOnce({ ...message })
		;(await mountReader(9)).destroy()
		api.fetchMessage.mockReturnValueOnce(new Promise(() => {}))

		const again = shallowMount(Reader, { propsData: { messageId: 9 }, mocks: l10nMocks })

		expect(again.text()).toContain('Quarterly numbers')
		expect(again.text()).not.toContain('Loading')
	})

	it('keeps showing that copy when the connection drops', async () => {
		api.fetchMessage.mockResolvedValueOnce({ ...message })
		;(await mountReader(9)).destroy()
		store.offline = true
		api.fetchMessage.mockRejectedValueOnce({ code: 'ERR_NETWORK' })

		const again = await mountReader(9)

		expect(again.text()).toContain('Quarterly numbers')
		expect(again.vm.error).toBe(null)
	})

	it('says there is no connection and offers to try again', async () => {
		store.offline = true
		api.fetchMessage.mockRejectedValueOnce({ code: 'ERR_NETWORK' })

		const reader = await mountReader(11)

		expect(reader.text()).toContain('No connection to the server, so this message could not be loaded.')
		api.fetchMessage.mockResolvedValueOnce({ ...message })
		await reader.find('.reader__retry').trigger('click')
		for (let i = 0; i < 4; i++) {
			await Promise.resolve()
		}
		await reader.vm.$nextTick()
		expect(reader.text()).toContain('Quarterly numbers')
	})

	it('tries again when the page asks it to', async () => {
		api.fetchMessage.mockResolvedValue({ ...message })
		const reader = await mountReader(9)

		await reader.setProps({ refreshTick: 1 })

		expect(api.fetchMessage).toHaveBeenCalledTimes(2)
	})
})

describe('mobile Reader star', () => {
	let api
	let store

	async function open({ flagged = false, listed = null } = {}) {
		api.fetchMessage.mockResolvedValue({ ...message, flags: { seen: true, flagged } })
		store.currentEnvelope = listed
		const wrapper = shallowMount(Reader, { propsData: { messageId: 9 }, mocks: l10nMocks })
		for (let i = 0; i < 4; i++) {
			await wrapper.vm.$nextTick()
		}
		return wrapper
	}

	function star(wrapper) {
		return wrapper.find('.reader__action--star')
	}

	beforeEach(async () => {
		forgetEverything()
		api = await import('../../src/api/mail.js')
		;({ store } = await import('../../src/store.js'))
		api.setFlags.mockReset()
		api.setFlags.mockResolvedValue(undefined)
	})

	it('shows a starred message as starred, also when opened from a notification', async () => {
		const wrapper = await open({ flagged: true })

		expect(star(wrapper).text()).toBe('★')
		expect(star(wrapper).attributes('aria-pressed')).toBe('true')
		expect(star(wrapper).attributes('aria-label')).toBe('Star')
		expect(star(wrapper).classes()).toContain('reader__action--starred')
	})

	it('stars it in Mail, and the list and the copy kept for this visit follow', async () => {
		const listed = { databaseId: 9, flags: { seen: true, flagged: false } }
		const wrapper = await open({ listed })

		await star(wrapper).trigger('click')
		await wrapper.vm.$nextTick()

		expect(api.setFlags).toHaveBeenCalledWith(9, { flagged: true })
		expect(star(wrapper).text()).toBe('★')
		expect(listed.flags.flagged).toBe(true)
		expect(recallMessage(9).flags.flagged).toBe(true)
	})

	it('never changes the list entry of another message', async () => {
		const other = { databaseId: 4, flags: { seen: true, flagged: false } }
		const wrapper = await open({ listed: other })

		await star(wrapper).trigger('click')

		expect(other.flags.flagged).toBe(false)
	})

	it('puts the star back as it was when Mail does not take it', async () => {
		const wrapper = await open({ flagged: true })
		api.setFlags.mockRejectedValueOnce(new Error('Request failed with status 500'))

		await wrapper.vm.toggleFlagged()

		expect(wrapper.vm.flagged).toBe(true)
		expect(wrapper.vm.flagging).toBe(false)
	})

	it('ignores a second tap while the first is on its way', async () => {
		const wrapper = await open()
		let answer
		api.setFlags.mockReturnValueOnce(new Promise((resolve) => {
			answer = resolve
		}))

		const first = wrapper.vm.toggleFlagged()
		await wrapper.vm.toggleFlagged()
		answer()
		await first

		expect(api.setFlags).toHaveBeenCalledTimes(1)
		expect(wrapper.vm.flagged).toBe(true)
	})
})
