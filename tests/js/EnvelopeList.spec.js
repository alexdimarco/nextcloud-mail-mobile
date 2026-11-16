/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EnvelopeList from '../../src/views/EnvelopeList.vue'
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
	syncMailbox: vi.fn().mockResolvedValue(undefined),
}))

// hoisted so the (hoisted) vi.mock factory below can close over it
const storeMock = vi.hoisted(() => ({ threaded: false }))

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
		storeMock.threaded = false
		const { fetchEnvelopes } = await import('../../src/api/mail.js')
		fetchEnvelopes.mockResolvedValue(ENVELOPES.map((item) => ({ ...item, flags: { ...item.flags } })))
		wrapper = await mountWith()
	})

	it('syncs the mailbox from IMAP before reading the cache on refresh', async () => {
		const { syncMailbox, fetchEnvelopes } = await import('../../src/api/mail.js')
		syncMailbox.mockClear()
		fetchEnvelopes.mockClear()

		await wrapper.vm.refresh()

		expect(syncMailbox).toHaveBeenCalledWith(INBOX.databaseId)
		expect(fetchEnvelopes).toHaveBeenCalledWith(INBOX.databaseId, undefined, false)
	})

	it('still shows cached messages when the sync fails', async () => {
		const { syncMailbox, fetchEnvelopes } = await import('../../src/api/mail.js')
		syncMailbox.mockRejectedValueOnce(new Error('offline'))
		fetchEnvelopes.mockResolvedValueOnce(ENVELOPES.map((item) => ({ ...item, flags: { ...item.flags } })))

		await wrapper.vm.refresh()

		expect(fetchEnvelopes).toHaveBeenCalledWith(INBOX.databaseId, undefined, false)
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
		storeMock.threaded = true
	})

	it('requests the threaded view from the server', async () => {
		const { fetchEnvelopes } = await import('../../src/api/mail.js')

		await mountThreaded()

		expect(fetchEnvelopes).toHaveBeenCalledWith(INBOX.databaseId, undefined, true)
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
