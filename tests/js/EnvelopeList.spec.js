/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EnvelopeList from '../../src/views/EnvelopeList.vue'
import { forgetEverything, recallList } from '../../src/memory.js'
import { l10nMocks } from './l10n.js'

function envelope(id, overrides = {}) {
	return {
		databaseId: id,
		subject: `Subject ${id}`,
		from: [{ label: 'Alice', email: 'alice@example.com' }],
		flags: { seen: true, flagged: false, hasAttachments: false },
		dateInt: 1700000000,
		previewText: 'preview',
		...overrides,
	}
}

const ENVELOPES = [envelope(101), envelope(102), envelope(103)]

const INBOX = { databaseId: 2, accountId: 1, displayName: 'Inbox' }
const ACCOUNT = {
	id: 1,
	trashMailboxId: 9,
	archiveMailboxId: 8,
	mailboxes: [
		INBOX,
		{ databaseId: 8, accountId: 1, displayName: 'Archive' },
		{ databaseId: 9, accountId: 1, displayName: 'Trash' },
		{ databaseId: 3, accountId: 1, displayName: 'Work' },
	],
}

vi.mock('../../src/api/mail.js', () => ({
	fetchEnvelopes: vi.fn().mockResolvedValue([]),
	fetchThread: vi.fn().mockResolvedValue([]),
	looksLikeConversation: vi.fn((envelope) => !!envelope.threadRootId && envelope.threadRootId !== envelope.messageId),
	deleteMessage: vi.fn().mockResolvedValue(undefined),
	moveMessage: vi.fn().mockResolvedValue(undefined),
	// The real one is tested in mail-api.spec.js
	searchFilter: vi.fn((text, { body = false } = {}) => (text ? `search:${text}${body ? ':body' : ''}` : '')),
	syncMailbox: vi.fn().mockResolvedValue(undefined),
	setJunk: vi.fn().mockResolvedValue(undefined),
	pinnedFilter: vi.fn((tagId) => `tags:${tagId}`),
	isPinned: (envelope) => !!envelope?.tags?.$pinned,
}))

// hoisted so the (hoisted) vi.mock factory below can close over it
const storeMock = vi.hoisted(() => ({ threaded: false, pinnedTagId: null }))

vi.mock('../../src/store.js', () => ({
	accountFor: vi.fn(() => ACCOUNT),
	store: storeMock,
	setThreaded: vi.fn((value) => { storeMock.threaded = value }),
}))

function row(envelope, child = false) {
	return { envelope, child, header: false }
}

describe('mobile EnvelopeList selection, swipe and move', () => {
	let wrapper

	async function mountWith(mailbox = INBOX) {
		const { fetchEnvelopes } = await import('../../src/api/mail.js')
		fetchEnvelopes.mockResolvedValue(ENVELOPES.map((item) => ({ ...item, flags: { ...item.flags } })))
		const instance = shallowMount(EnvelopeList, {
			propsData: { mailbox },
			mocks: l10nMocks,
		})
		// Skip the real release-animation delay in tests
		instance.vm.wait = () => Promise.resolve()
		await instance.vm.$nextTick()
		await instance.vm.$nextTick()
		return instance
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		forgetEverything()
		storeMock.threaded = false
		const { fetchEnvelopes } = await import('../../src/api/mail.js')
		fetchEnvelopes.mockResolvedValue(ENVELOPES.map((item) => ({ ...item, flags: { ...item.flags } })))
		wrapper = await mountWith()
	})

	it('shows the list Mail already has first, then checks for new mail and reads it again', async () => {
		const { syncMailbox, fetchEnvelopes } = await import('../../src/api/mail.js')
		syncMailbox.mockClear()
		fetchEnvelopes.mockClear()

		await wrapper.vm.refresh()

		expect(syncMailbox).toHaveBeenCalledWith(INBOX.databaseId)
		expect(fetchEnvelopes).toHaveBeenCalledTimes(2)
		expect(fetchEnvelopes).toHaveBeenCalledWith(INBOX.databaseId, undefined, false, '')
		const [firstRead, secondRead] = fetchEnvelopes.mock.invocationCallOrder
		const [check] = syncMailbox.mock.invocationCallOrder
		expect(firstRead).toBeLessThan(check)
		expect(check).toBeLessThan(secondRead)
	})

	it('still shows cached messages when the sync fails', async () => {
		const { syncMailbox, fetchEnvelopes } = await import('../../src/api/mail.js')
		syncMailbox.mockRejectedValueOnce(new Error('offline'))
		fetchEnvelopes.mockResolvedValueOnce(ENVELOPES.map((item) => ({ ...item, flags: { ...item.flags } })))

		await wrapper.vm.refresh()

		expect(fetchEnvelopes).toHaveBeenCalledWith(INBOX.databaseId, undefined, false, '')
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([101, 102, 103])
	})

	it('enters selection mode by toggling a row, and stays in it after deselecting', () => {
		expect(wrapper.vm.selectionMode).toBe(false)

		wrapper.vm.toggleSelection(101)
		expect(wrapper.vm.selectionMode).toBe(true)
		expect(wrapper.vm.selection).toEqual([101])

		// Deselecting the last row doesn't drop you out of selection mode —
		// only Cancel (exitSelection) does
		wrapper.vm.toggleSelection(101)
		expect(wrapper.vm.selectionMode).toBe(true)
		expect(wrapper.vm.selection).toEqual([])
	})

	it('enters an empty selection ready for "Select all" without picking a row first', () => {
		expect(wrapper.vm.selectionMode).toBe(false)

		wrapper.vm.enterSelectionMode()

		expect(wrapper.vm.selectionMode).toBe(true)
		expect(wrapper.vm.selection).toEqual([])

		wrapper.vm.toggleSelectAll()
		expect(wrapper.vm.selection).toEqual([101, 102, 103])
	})

	it('cancelling selection clears both the mode and the selection', () => {
		wrapper.vm.toggleSelection(101)

		wrapper.vm.exitSelection()

		expect(wrapper.vm.selectionMode).toBe(false)
		expect(wrapper.vm.selection).toEqual([])
	})

	it('selects and deselects all envelopes', () => {
		wrapper.vm.toggleSelectAll()
		expect(wrapper.vm.selection).toEqual([101, 102, 103])
		expect(wrapper.vm.allSelected).toBe(true)

		wrapper.vm.toggleSelectAll()
		expect(wrapper.vm.selection).toEqual([])
	})

	it('shows a Select entry point when not selecting, replaced by the selection bar once active', async () => {
		expect(wrapper.find('.listbar').exists()).toBe(true)
		expect(wrapper.find('.selectbar').exists()).toBe(false)

		wrapper.vm.enterSelectionMode()
		await wrapper.vm.$nextTick()

		expect(wrapper.find('.listbar').exists()).toBe(false)
		expect(wrapper.find('.selectbar').exists()).toBe(true)
	})

	it('disables the bulk action buttons while the selection is empty', async () => {
		wrapper.vm.enterSelectionMode()
		await wrapper.vm.$nextTick()

		expect(wrapper.find('.selectbar__icon--danger').attributes('disabled')).toBeTruthy()

		wrapper.vm.toggleSelection(101)
		await wrapper.vm.$nextTick()

		expect(wrapper.find('.selectbar__icon--danger').attributes('disabled')).toBeFalsy()
	})

	it('bulk-deletes selected envelopes and clears the selection', async () => {
		const { deleteMessage } = await import('../../src/api/mail.js')
		wrapper.vm.selection = [101, 102]

		await wrapper.vm.bulkDelete()

		expect(deleteMessage).toHaveBeenCalledWith(101)
		expect(deleteMessage).toHaveBeenCalledWith(102)
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([103])
		expect(wrapper.vm.selection).toEqual([])
	})

	it('bulk-archives selected envelopes into the account archive mailbox', async () => {
		const { moveMessage } = await import('../../src/api/mail.js')
		wrapper.vm.selection = [101]

		await wrapper.vm.bulkArchive()

		expect(moveMessage).toHaveBeenCalledWith(101, 8)
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([102, 103])
	})

	it('lists every other mailbox of the same account as a move destination', () => {
		expect(wrapper.vm.moveDestinations.map((item) => item.databaseId)).toEqual([8, 9, 3])
	})

	it('moves selected envelopes to the chosen destination and closes the sheet', async () => {
		const { moveMessage } = await import('../../src/api/mail.js')
		wrapper.vm.selection = [102]
		wrapper.vm.moveSheetOpen = true

		await wrapper.vm.confirmMove(3)

		expect(moveMessage).toHaveBeenCalledWith(102, 3)
		expect(wrapper.vm.moveSheetOpen).toBe(false)
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([101, 103])
	})

	it('swipe-deletes a single message', async () => {
		const { deleteMessage } = await import('../../src/api/mail.js')

		await wrapper.vm.swipeDelete(ENVELOPES[0])

		expect(deleteMessage).toHaveBeenCalledWith(101)
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([102, 103])
	})

	it('swipe-archives a single message', async () => {
		const { moveMessage } = await import('../../src/api/mail.js')

		await wrapper.vm.swipeArchive(ENVELOPES[1])

		expect(moveMessage).toHaveBeenCalledWith(102, 8)
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([101, 103])
	})

	it('restores the row and shows a notice when a swipe delete fails', async () => {
		const { deleteMessage } = await import('../../src/api/mail.js')
		deleteMessage.mockRejectedValueOnce(new Error('network'))

		await wrapper.vm.swipeDelete(ENVELOPES[0])

		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([101, 102, 103])
		expect(wrapper.vm.notice).toBeTruthy()
	})

	it('does not offer archive when viewing the account archive mailbox', async () => {
		const archiveMailbox = { databaseId: 8, accountId: 1, displayName: 'Archive' }
		const archiveView = await mountWith(archiveMailbox)

		expect(archiveView.vm.canArchive).toBe(false)
	})

	it('asks for confirmation before permanently deleting from the trash mailbox, and aborts on cancel', async () => {
		const trashMailbox = { databaseId: 9, accountId: 1, displayName: 'Trash' }
		const trashView = await mountWith(trashMailbox)
		const { deleteMessage } = await import('../../src/api/mail.js')
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

		await trashView.vm.swipeDelete(ENVELOPES[0])

		expect(confirmSpy).toHaveBeenCalled()
		expect(deleteMessage).not.toHaveBeenCalled()
		expect(trashView.vm.envelopes.map((item) => item.databaseId)).toEqual([101, 102, 103])
		confirmSpy.mockRestore()
	})

	it('deletes without asking when the trash confirmation is accepted', async () => {
		const trashMailbox = { databaseId: 9, accountId: 1, displayName: 'Trash' }
		const trashView = await mountWith(trashMailbox)
		const { deleteMessage } = await import('../../src/api/mail.js')
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

		await trashView.vm.swipeDelete(ENVELOPES[0])

		expect(deleteMessage).toHaveBeenCalledWith(101)
		confirmSpy.mockRestore()
	})

	it('treats a plain tap (no gesture) as opening the message', () => {
		const clickEvent = { preventDefault: vi.fn() }

		wrapper.vm.onRowClick(row(ENVELOPES[0]), clickEvent)

		expect(wrapper.emitted('open')[0][0]).toEqual(ENVELOPES[0])
		expect(clickEvent.preventDefault).not.toHaveBeenCalled()
	})

	it('suppresses the click that follows a swipe or long-press', () => {
		const clickEvent = { preventDefault: vi.fn() }
		wrapper.vm.gesture = 'swipe'

		wrapper.vm.onRowClick(row(ENVELOPES[0]), clickEvent)

		expect(clickEvent.preventDefault).toHaveBeenCalled()
		expect(wrapper.emitted('open')).toBeFalsy()
		expect(wrapper.vm.gesture).toBe(null)
	})

	it('toggles selection instead of opening while in selection mode', () => {
		wrapper.vm.selectionMode = true
		wrapper.vm.selection = [102]

		wrapper.vm.onRowClick(row(ENVELOPES[0]), { preventDefault: vi.fn() })

		expect(wrapper.vm.selection).toEqual([102, 101])
		expect(wrapper.emitted('open')).toBeFalsy()
	})
})

describe('mobile EnvelopeList threaded (conversation) view', () => {
	async function mountThreaded() {
		const { fetchEnvelopes } = await import('../../src/api/mail.js')
		fetchEnvelopes.mockResolvedValue(ENVELOPES.map((item) => ({ ...item, flags: { ...item.flags } })))
		const instance = shallowMount(EnvelopeList, {
			propsData: { mailbox: INBOX },
			mocks: l10nMocks,
		})
		instance.vm.wait = () => Promise.resolve()
		await instance.vm.$nextTick()
		await instance.vm.$nextTick()
		return instance
	}

	beforeEach(() => {
		vi.clearAllMocks()
		forgetEverything()
		storeMock.threaded = true
	})

	it('requests the threaded view from the server', async () => {
		const { fetchEnvelopes } = await import('../../src/api/mail.js')

		await mountThreaded()

		expect(fetchEnvelopes).toHaveBeenCalledWith(INBOX.databaseId, undefined, true, '')
	})

	it('opens the message directly when a conversation has a single message', async () => {
		const { fetchThread } = await import('../../src/api/mail.js')
		fetchThread.mockResolvedValueOnce([ENVELOPES[0]])
		const view = await mountThreaded()

		await view.vm.onThreadHeaderTap(ENVELOPES[0])

		expect(view.emitted('open')[0][0]).toEqual(ENVELOPES[0])
		expect(view.vm.expandedIds).toEqual([])
	})

	it('expands a multi-message conversation inline instead of opening it', async () => {
		const { fetchThread } = await import('../../src/api/mail.js')
		const thread = [envelope(101), envelope(201), envelope(202)]
		fetchThread.mockResolvedValueOnce(thread)
		const view = await mountThreaded()

		await view.vm.onThreadHeaderTap(ENVELOPES[0])

		expect(view.emitted('open')).toBeFalsy()
		expect(view.vm.expandedIds).toEqual([101])
		// header row + 3 child messages interleaved after it
		const rows = view.vm.displayRows
		const inbox101 = rows.findIndex((r) => !r.child && r.envelope.databaseId === 101)
		expect(rows[inbox101].header).toBe(true)
		expect(rows[inbox101].count).toBe(3)
		expect(rows.filter((r) => r.child).map((r) => r.envelope.databaseId)).toEqual([101, 201, 202])
	})

	it('collapsing a conversation removes its children and deselects them', async () => {
		const { fetchThread } = await import('../../src/api/mail.js')
		fetchThread.mockResolvedValueOnce([envelope(101), envelope(201)])
		const view = await mountThreaded()
		await view.vm.onThreadHeaderTap(ENVELOPES[0])
		view.vm.toggleSelection(201)
		expect(view.vm.selection).toEqual([201])

		view.vm.collapse(101)

		expect(view.vm.expandedIds).toEqual([])
		expect(view.vm.selection).toEqual([])
		expect(view.vm.displayRows.some((r) => r.child)).toBe(false)
	})

	it('treats only individual messages inside a thread as actionable', async () => {
		const view = await mountThreaded()

		expect(view.vm.isActionable({ envelope: ENVELOPES[0], child: false })).toBe(false)
		expect(view.vm.isActionable({ envelope: ENVELOPES[0], child: true })).toBe(true)
	})

	it('swipe-deletes an individual message out of an expanded thread', async () => {
		const { fetchThread, deleteMessage } = await import('../../src/api/mail.js')
		fetchThread.mockResolvedValueOnce([envelope(101), envelope(201), envelope(202)])
		const view = await mountThreaded()
		await view.vm.onThreadHeaderTap(ENVELOPES[0])

		await view.vm.swipeDelete(envelope(201))

		expect(deleteMessage).toHaveBeenCalledWith(201)
		expect(view.vm.threadChildren[101].map((c) => c.databaseId)).toEqual([101, 202])
	})

	it('persists the toggle and reloads when switching views', async () => {
		const { setThreaded } = await import('../../src/store.js')
		const view = await mountThreaded()

		view.vm.toggleThreaded()

		expect(setThreaded).toHaveBeenCalledWith(false)
	})

	it('marks only multi-message conversations with a disclosure chevron', async () => {
		const { fetchEnvelopes } = await import('../../src/api/mail.js')
		// 101 is a reply (its conversation started elsewhere); 102 stands alone
		const reply = envelope(101, { messageId: '<b@x>', threadRootId: '<a@x>' })
		const single = envelope(102, { messageId: '<c@x>', threadRootId: '<c@x>' })
		fetchEnvelopes.mockResolvedValue([reply, single])
		const view = await mountThreaded()

		expect(view.vm.isConversation({ envelope: reply, child: false, header: false })).toBe(true)
		expect(view.vm.isConversation({ envelope: single, child: false, header: false })).toBe(false)
		// child rows and expanded headers never get the collapsed-row chevron
		expect(view.vm.isConversation({ envelope: reply, child: true, header: false })).toBe(false)
		expect(view.vm.isConversation({ envelope: reply, child: false, header: true })).toBe(false)
	})
})

describe('mobile EnvelopeList on a slow or dead connection', () => {
	const NO_ANSWER = { code: 'ERR_NETWORK', message: 'Network Error' }

	function fresh(ids) {
		return ids.map((id) => envelope(id))
	}

	async function mount(options = {}) {
		const instance = shallowMount(EnvelopeList, {
			propsData: { mailbox: INBOX },
			mocks: l10nMocks,
			...options,
		})
		instance.vm.wait = () => Promise.resolve()
		await flush()
		return instance
	}

	async function flush() {
		for (let i = 0; i < 6; i++) {
			await Promise.resolve()
		}
	}

	let api

	beforeEach(async () => {
		vi.clearAllMocks()
		forgetEverything()
		storeMock.threaded = false
		api = await import('../../src/api/mail.js')
		api.fetchEnvelopes.mockReset()
		api.syncMailbox.mockReset()
		api.syncMailbox.mockResolvedValue(undefined)
		api.fetchEnvelopes.mockResolvedValue(fresh([101, 102, 103]))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('shows the list from earlier in the visit at once, before Mail answers', async () => {
		const first = await mount()
		first.destroy()
		api.fetchEnvelopes.mockReturnValue(new Promise(() => {}))

		const again = shallowMount(EnvelopeList, { propsData: { mailbox: INBOX }, mocks: l10nMocks })

		expect(again.vm.envelopes.map((item) => item.databaseId)).toEqual([101, 102, 103])
		expect(again.text()).not.toContain('Loading')
	})

	it('does not check for new mail when Mail did not answer, and offers to try again', async () => {
		api.fetchEnvelopes.mockRejectedValueOnce(NO_ANSWER)

		const list = await mount()

		expect(api.syncMailbox).not.toHaveBeenCalled()
		expect(list.text()).toContain('Could not load the messages.')
		expect(list.text()).not.toContain('No messages')

		await list.find('.list__retry').trigger('click')
		await flush()
		expect(list.vm.envelopes.map((item) => item.databaseId)).toEqual([101, 102, 103])
		expect(list.find('.list__retry').exists()).toBe(false)
	})

	it('still checks for new mail when Mail answers with an error (a folder it never read)', async () => {
		api.fetchEnvelopes
			.mockRejectedValueOnce({ response: { status: 428 } })
			.mockResolvedValueOnce(fresh([101]))

		const list = await mount()

		expect(api.syncMailbox).toHaveBeenCalledWith(INBOX.databaseId)
		expect(list.vm.envelopes.map((item) => item.databaseId)).toEqual([101])
	})

	it('says "Loading", not "Could not load", while Mail fills a folder it never read', async () => {
		let finishCheck
		api.syncMailbox.mockReturnValue(new Promise((resolve) => {
			finishCheck = resolve
		}))
		api.fetchEnvelopes
			.mockRejectedValueOnce({ response: { status: 428 } })
			.mockResolvedValueOnce(fresh([101]))

		const list = await mount()
		await list.vm.$nextTick()
		expect(list.text()).toContain('Loading')
		expect(list.text()).not.toContain('Could not load')

		finishCheck()
		await flush()
		await list.vm.$nextTick()
		expect(list.vm.envelopes.map((item) => item.databaseId)).toEqual([101])
	})

	it('says it could not load when both reading and checking failed', async () => {
		api.fetchEnvelopes.mockRejectedValueOnce({ response: { status: 500 } })
		api.syncMailbox.mockRejectedValueOnce({ response: { status: 500 } })

		const list = await mount()
		await list.vm.$nextTick()

		expect(list.text()).toContain('Could not load the messages.')
	})

	it('keeps what is on screen when the connection drops', async () => {
		const list = await mount()
		api.fetchEnvelopes.mockRejectedValueOnce(NO_ANSWER)

		await list.vm.refresh()

		expect(list.vm.envelopes.map((item) => item.databaseId)).toEqual([101, 102, 103])
		expect(list.vm.loadFailed).toBe(false)
	})

	it('a background update keeps the selection, minus messages that are gone', async () => {
		const list = await mount()
		list.vm.toggleSelection(101)
		list.vm.toggleSelection(103)
		api.fetchEnvelopes.mockResolvedValue(fresh([100, 101, 102]))

		await list.vm.refresh()

		expect(list.vm.envelopes.map((item) => item.databaseId)).toEqual([100, 101, 102])
		expect(list.vm.selection).toEqual([101])
		expect(list.vm.selectionMode).toBe(true)
	})

	it('keeps older messages loaded with "Load more" when the first page is updated', async () => {
		const page = (from) => Array.from({ length: 25 }, (_, i) => envelope(from + i, { dateInt: 2000 - from - i }))
		api.fetchEnvelopes.mockResolvedValue(page(1))
		const list = await mount()
		api.fetchEnvelopes.mockResolvedValueOnce(page(26))
		await list.vm.loadMore()
		expect(list.vm.envelopes).toHaveLength(50)

		api.fetchEnvelopes.mockResolvedValue(page(1))
		await list.vm.refresh()

		expect(list.vm.envelopes).toHaveLength(50)
	})

	it('an older, slower refresh never overwrites a newer one', async () => {
		const list = await mount()
		let answerSlow
		api.fetchEnvelopes.mockReturnValueOnce(new Promise((resolve) => {
			answerSlow = resolve
		}))
		const slow = list.vm.refresh()
		api.fetchEnvelopes.mockResolvedValue(fresh([104]))
		await list.vm.refresh()

		answerSlow(fresh([101]))
		await slow

		expect(list.vm.envelopes.map((item) => item.databaseId)).toEqual([104])
	})

	it('says it is checking for new mail only when that takes a while', async () => {
		vi.useFakeTimers()
		let finishCheck
		api.syncMailbox.mockReturnValue(new Promise((resolve) => {
			finishCheck = resolve
		}))
		const list = await mount()
		expect(list.text()).not.toContain('Checking for new mail')

		vi.advanceTimersByTime(1600)
		await list.vm.$nextTick()
		expect(list.text()).toContain('Checking for new mail')

		finishCheck()
		await flush()
		await list.vm.$nextTick()
		expect(list.text()).not.toContain('Checking for new mail')
	})

	it('comes back to the same place in the list after reading a message', async () => {
		const scroller = document.createElement('div')
		scroller.style.overflowY = 'auto'
		const host = document.createElement('div')
		scroller.appendChild(host)
		document.body.appendChild(scroller)
		Object.defineProperty(scroller, 'scrollTop', { value: 240, writable: true })
		const list = await mount({ attachTo: host })

		list.vm.onRowClick({ envelope: list.vm.envelopes[1], child: false, header: false }, { preventDefault() {} })
		expect(recallList(INBOX.databaseId, false).scrollTop).toBe(240)
		list.destroy()

		const back = document.createElement('div')
		back.style.overflowY = 'auto'
		const backHost = document.createElement('div')
		back.appendChild(backHost)
		document.body.appendChild(back)
		Object.defineProperty(back, 'scrollTop', { value: 0, writable: true })
		await mount({ attachTo: backHost })
		await Promise.resolve()

		expect(back.scrollTop).toBe(240)
	})
})

describe('mobile EnvelopeList search', () => {
	let api

	function fresh(ids) {
		return ids.map((id) => envelope(id))
	}

	async function flush() {
		for (let i = 0; i < 6; i++) {
			await Promise.resolve()
		}
	}

	async function mount() {
		const instance = shallowMount(EnvelopeList, {
			propsData: { mailbox: INBOX },
			mocks: l10nMocks,
		})
		await flush()
		return instance
	}

	// What the list asked Mail for, as [cursor, search]
	function reads() {
		return api.fetchEnvelopes.mock.calls.map((call) => [call[1], call[3]])
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		forgetEverything()
		storeMock.threaded = false
		delete ACCOUNT.searchBody
		api = await import('../../src/api/mail.js')
		api.fetchEnvelopes.mockReset()
		api.syncMailbox.mockReset()
		api.syncMailbox.mockResolvedValue(undefined)
		api.fetchEnvelopes.mockResolvedValue(fresh([101, 102, 103]))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('searches once the person stops typing for a moment', async () => {
		vi.useFakeTimers()
		const wrapper = await mount()
		api.fetchEnvelopes.mockClear()
		api.fetchEnvelopes.mockResolvedValue(fresh([102]))

		await wrapper.find('.search__input').setValue('inv')
		await wrapper.find('.search__input').setValue('invoice')
		vi.advanceTimersByTime(499)
		expect(api.fetchEnvelopes).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		await flush()

		// Only the last text; first what Mail has, then after the check
		expect(reads()).toEqual([[undefined, 'search:invoice'], [undefined, 'search:invoice']])
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([102])
	})

	it('searches at once on Enter', async () => {
		const wrapper = await mount()
		api.fetchEnvelopes.mockClear()

		await wrapper.find('.search__input').setValue('invoice')
		await wrapper.find('form.search').trigger('submit')
		await flush()

		expect(reads()[0]).toEqual([undefined, 'search:invoice'])
	})

	it('does not search for a single letter', async () => {
		vi.useFakeTimers()
		const wrapper = await mount()
		api.fetchEnvelopes.mockClear()

		await wrapper.find('.search__input').setValue('i')
		vi.advanceTimersByTime(1000)
		await wrapper.find('form.search').trigger('submit')
		await flush()

		expect(api.fetchEnvelopes).not.toHaveBeenCalled()
	})

	it('also searches the message text when the account says so, as Mail does', async () => {
		ACCOUNT.searchBody = true
		const wrapper = await mount()
		api.fetchEnvelopes.mockClear()

		await wrapper.find('.search__input').setValue('invoice')
		await wrapper.find('form.search').trigger('submit')
		await flush()

		expect(reads()[0]).toEqual([undefined, 'search:invoice:body'])
	})

	it('says when nothing was found', async () => {
		const wrapper = await mount()
		api.fetchEnvelopes.mockResolvedValue([])

		await wrapper.find('.search__input').setValue('nothing here')
		await wrapper.find('form.search').trigger('submit')
		await flush()

		expect(wrapper.find('.list__status').text()).toBe('Nothing found for "nothing here"')
	})

	it('clearing the search shows the whole folder again at once', async () => {
		const wrapper = await mount()
		api.fetchEnvelopes.mockResolvedValue(fresh([102]))
		await wrapper.find('.search__input').setValue('invoice')
		await wrapper.find('form.search').trigger('submit')
		await flush()
		api.fetchEnvelopes.mockClear()
		api.fetchEnvelopes.mockReturnValue(new Promise(() => {}))

		await wrapper.find('.search__clear').trigger('click')

		expect(wrapper.vm.query).toBe('')
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([101, 102, 103])
		expect(reads()[0]).toEqual([undefined, ''])
	})

	it('back from a message returns to the same search and its results', async () => {
		const first = await mount()
		api.fetchEnvelopes.mockResolvedValue(fresh([102]))
		await first.find('.search__input').setValue('invoice')
		await first.find('form.search').trigger('submit')
		await flush()
		first.destroy()
		api.fetchEnvelopes.mockReturnValue(new Promise(() => {}))

		const again = await mount()

		expect(again.find('.search__input').element.value).toBe('invoice')
		expect(again.vm.envelopes.map((item) => item.databaseId)).toEqual([102])
		expect(api.fetchEnvelopes).toHaveBeenLastCalledWith(INBOX.databaseId, undefined, false, 'search:invoice')
	})

	it('loads more results of the same search', async () => {
		const wrapper = await mount()
		api.fetchEnvelopes.mockResolvedValue(Array.from({ length: 25 }, (_, i) => envelope(200 + i, { dateInt: 1700000000 - i })))
		await wrapper.find('.search__input').setValue('invoice')
		await wrapper.find('form.search').trigger('submit')
		await flush()
		api.fetchEnvelopes.mockClear()
		api.fetchEnvelopes.mockResolvedValue([envelope(300, { dateInt: 1600000000 })])

		await wrapper.vm.loadMore()

		expect(reads()).toEqual([[1700000000 - 24, 'search:invoice']])
		expect(wrapper.vm.envelopes).toHaveLength(26)
	})

	it('drops a page of results that arrives after the search changed', async () => {
		const wrapper = await mount()
		let answer
		api.fetchEnvelopes.mockReturnValueOnce(new Promise((resolve) => {
			answer = resolve
		}))
		const loading = wrapper.vm.loadMore()

		await wrapper.find('.search__input').setValue('invoice')
		api.fetchEnvelopes.mockResolvedValue(fresh([102]))
		await wrapper.find('form.search').trigger('submit')
		await flush()
		answer([envelope(999, { dateInt: 1 })])
		await loading

		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([102])
	})

	it('hides the search box while selecting messages', async () => {
		const wrapper = await mount()

		wrapper.vm.enterSelectionMode()
		await wrapper.vm.$nextTick()

		expect(wrapper.find('form.search').exists()).toBe(false)
	})
})

describe('mobile EnvelopeList pinned messages', () => {
	let api

	const PINNED_TAGS = { $pinned: { id: 9, imapLabel: '$pinned', displayName: 'Pinned' } }

	async function flush() {
		for (let i = 0; i < 8; i++) {
			await Promise.resolve()
		}
	}

	async function mount(mailbox = INBOX) {
		const instance = shallowMount(EnvelopeList, {
			propsData: { mailbox },
			mocks: l10nMocks,
		})
		instance.vm.wait = () => Promise.resolve()
		await flush()
		return instance
	}

	// Mail's answers: the pinned messages for the "Pinned" tag, else the folder
	function answer({ folder, pinned }) {
		api.fetchEnvelopes.mockImplementation(async (mailboxId, cursor, threaded, filter) => (filter === 'tags:9'
			? pinned.map((item) => ({ ...item }))
			: folder.map((item) => ({ ...item }))))
	}

	function shownRows(wrapper) {
		return wrapper.vm.displayRows.map((row) => row.section ?? row.envelope.databaseId)
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		forgetEverything()
		storeMock.threaded = false
		storeMock.pinnedTagId = 9
		api = await import('../../src/api/mail.js')
		api.fetchEnvelopes.mockReset()
		api.syncMailbox.mockReset()
		api.syncMailbox.mockResolvedValue(undefined)
		answer({
			folder: [envelope(101), envelope(102), envelope(103, { tags: PINNED_TAGS })],
			pinned: [envelope(103, { tags: PINNED_TAGS })],
		})
	})

	afterEach(() => {
		storeMock.pinnedTagId = null
	})

	it('shows the pinned messages first, under their heading, and each message once', async () => {
		const wrapper = await mount()

		expect(api.fetchEnvelopes).toHaveBeenCalledWith(INBOX.databaseId, undefined, false, 'tags:9')
		expect(shownRows(wrapper)).toEqual(['pinned', 103, 'rest', 101, 102])
		expect(wrapper.find('.list__section').text()).toContain('Pinned')
		expect(wrapper.findAll('.row__pin')).toHaveLength(1)
	})

	it('shows no heading when nothing in the folder is pinned', async () => {
		answer({ folder: [envelope(101), envelope(102)], pinned: [] })
		const wrapper = await mount()

		expect(shownRows(wrapper)).toEqual([101, 102])
		expect(wrapper.find('.list__section').exists()).toBe(false)
	})

	it('does not ask for pinned messages before anything was ever pinned', async () => {
		storeMock.pinnedTagId = null
		answer({ folder: [envelope(101), envelope(102)], pinned: [] })
		const wrapper = await mount()

		expect(api.fetchEnvelopes.mock.calls.every((call) => call[3] === '')).toBe(true)
		expect(shownRows(wrapper)).toEqual([101, 102])
	})

	it('shows search results in their own order, with the pin mark and no heading', async () => {
		const wrapper = await mount()
		api.fetchEnvelopes.mockClear()

		wrapper.vm.query = 'Subject'
		wrapper.vm.applySearch()
		await flush()

		expect(api.fetchEnvelopes.mock.calls.some((call) => call[3] === 'tags:9')).toBe(false)
		expect(shownRows(wrapper)).toEqual([101, 102, 103])
		expect(wrapper.findAll('.row__pin')).toHaveLength(1)
	})

	it('keeps the pinned messages shown when they cannot be read this time', async () => {
		const wrapper = await mount()
		api.fetchEnvelopes.mockImplementation(async (mailboxId, cursor, threaded, filter) => {
			if (filter === 'tags:9') {
				throw new Error('no answer')
			}
			return [envelope(101), envelope(102), envelope(103, { tags: PINNED_TAGS })]
		})

		await wrapper.vm.refresh()

		expect(shownRows(wrapper)).toEqual(['pinned', 103, 'rest', 101, 102])
	})

	it('shows a pinned conversation once, on top, with conversations grouped', async () => {
		storeMock.threaded = true
		answer({
			folder: [envelope(201, { threadRootId: '<a@x>', messageId: '<a2@x>' }), envelope(301, { threadRootId: '<b@x>', messageId: '<b@x>' })],
			pinned: [envelope(200, { threadRootId: '<a@x>', messageId: '<a@x>', tags: PINNED_TAGS })],
		})
		const wrapper = await mount()

		expect(api.fetchEnvelopes).toHaveBeenCalledWith(INBOX.databaseId, undefined, true, 'tags:9')
		expect(shownRows(wrapper)).toEqual(['pinned', 200, 'rest', 301])
	})

	it('takes an archived or deleted pinned message off the screen at once', async () => {
		const wrapper = await mount()

		wrapper.vm.removeIdsFromView([103])

		expect(shownRows(wrapper)).toEqual([101, 102])
	})

	it('can select a pinned message with the others', async () => {
		const wrapper = await mount()

		wrapper.vm.toggleSelectAll()

		expect(wrapper.vm.selection).toEqual([103, 101, 102])
	})

	it('remembers the pinned messages for coming back from a message', async () => {
		await mount()

		expect(recallList(INBOX.databaseId, false).pinned.map((item) => item.databaseId)).toEqual([103])
	})
})

describe('mobile EnvelopeList junk', () => {
	let api

	const JUNK = { databaseId: 7, accountId: 1, displayName: 'Junk' }

	async function flush() {
		for (let i = 0; i < 8; i++) {
			await Promise.resolve()
		}
	}

	async function mount(mailbox = INBOX) {
		const instance = shallowMount(EnvelopeList, {
			propsData: { mailbox },
			mocks: l10nMocks,
		})
		await flush()
		return instance
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		forgetEverything()
		storeMock.threaded = false
		ACCOUNT.junkMailboxId = 7
		api = await import('../../src/api/mail.js')
		api.fetchEnvelopes.mockReset()
		api.fetchEnvelopes.mockResolvedValue([envelope(101), envelope(102), envelope(103)])
		api.syncMailbox.mockResolvedValue(undefined)
		api.setJunk.mockReset()
		api.setJunk.mockResolvedValue(undefined)
	})

	afterEach(() => {
		delete ACCOUNT.junkMailboxId
	})

	it('moves the selected messages to junk', async () => {
		const wrapper = await mount()
		wrapper.vm.toggleSelection(101)
		wrapper.vm.toggleSelection(103)
		await wrapper.vm.$nextTick()

		const button = wrapper.find('[aria-label="Move to junk"]')
		expect(button.text()).toBe('🚫')
		await button.trigger('click')
		await flush()

		expect(api.setJunk.mock.calls).toEqual([[101, true], [103, true]])
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([102])
		expect(wrapper.vm.selectionMode).toBe(false)
	})

	it('in the junk folder, moves them back to the inbox as not junk', async () => {
		const wrapper = await mount(JUNK)
		wrapper.vm.toggleSelection(102)
		await wrapper.vm.$nextTick()

		await wrapper.find('[aria-label="Not junk: move to the inbox"]').trigger('click')
		await flush()

		expect(api.setJunk).toHaveBeenCalledWith(102, false)
	})

	it('is not offered when the account has no junk folder', async () => {
		delete ACCOUNT.junkMailboxId
		const wrapper = await mount()
		wrapper.vm.enterSelectionMode()
		await wrapper.vm.$nextTick()

		expect(wrapper.find('[aria-label="Move to junk"]').exists()).toBe(false)
	})

	it('says how many could not be moved, and reads the list again', async () => {
		api.setJunk.mockRejectedValueOnce(new Error('no'))
		const wrapper = await mount()
		api.fetchEnvelopes.mockClear()
		wrapper.vm.toggleSelection(101)
		wrapper.vm.toggleSelection(102)

		await wrapper.vm.bulkJunk()
		await flush()

		expect(wrapper.vm.notice).toBe('Could not move 1 message to junk')
		expect(api.fetchEnvelopes).toHaveBeenCalled()
	})
})

describe('mobile EnvelopeList tells the page about refreshing', () => {
	let api

	async function flush() {
		for (let i = 0; i < 8; i++) {
			await Promise.resolve()
		}
	}

	async function mount() {
		const instance = shallowMount(EnvelopeList, {
			propsData: { mailbox: INBOX },
			mocks: l10nMocks,
		})
		await flush()
		return instance
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		forgetEverything()
		storeMock.threaded = false
		api = await import('../../src/api/mail.js')
		api.fetchEnvelopes.mockReset()
		api.fetchEnvelopes.mockResolvedValue([envelope(101)])
		api.syncMailbox.mockReset()
		api.syncMailbox.mockResolvedValue(undefined)
	})

	it('says it is busy while refreshing, and that it checked for new mail', async () => {
		const wrapper = await mount()

		expect(wrapper.emitted('busy').map(([value]) => value)).toEqual([true, false])
		expect(wrapper.emitted('refreshed')).toEqual([[true]])
	})

	it('says so when checking for new mail did not work', async () => {
		api.syncMailbox.mockRejectedValueOnce(new Error('mail server down'))
		const wrapper = await mount()

		expect(wrapper.emitted('refreshed')).toEqual([[false]])
		expect(wrapper.vm.envelopes.map((item) => item.databaseId)).toEqual([101])
	})

	it('says so when the server did not answer at all', async () => {
		api.fetchEnvelopes.mockRejectedValueOnce({ code: 'ERR_NETWORK', message: 'Network Error' })
		const wrapper = await mount()

		expect(wrapper.emitted('refreshed')).toEqual([[false]])
		expect(api.syncMailbox).not.toHaveBeenCalled()
	})

	it('answers once for two refreshes in a row: for the newer one', async () => {
		const wrapper = await mount()

		await Promise.all([wrapper.vm.refresh(), wrapper.vm.refresh()])

		expect(wrapper.emitted('refreshed')).toEqual([[true], [true]])
	})

	it('stops being busy when it goes away in the middle of a refresh', async () => {
		api.syncMailbox.mockReturnValue(new Promise(() => {}))
		const wrapper = await mount()
		expect(wrapper.emitted('busy').map(([value]) => value)).toEqual([true])

		wrapper.destroy()

		expect(wrapper.emitted('busy').map(([value]) => value)).toEqual([true, false])
	})
})
