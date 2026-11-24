/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
	forgetEverything,
	forgetMessage,
	recallList,
	recallMessage,
	recallSearch,
	rememberList,
	rememberMessage,
	rememberSearch,
} from '../../src/memory.js'

describe('mail remembered during the visit', () => {
	beforeEach(() => {
		forgetEverything()
	})

	it('keeps a folder\'s list per view, and adds to it', () => {
		rememberList(2, false, { envelopes: [{ databaseId: 1 }], exhausted: true })
		rememberList(2, false, { scrollTop: 300 })

		expect(recallList(2, false)).toEqual({ envelopes: [{ databaseId: 1 }], pinned: [], exhausted: true, scrollTop: 300 })
		// The conversations view of the same folder is a different list
		expect(recallList(2, true)).toBe(null)
	})

	it('keeps search results apart from the whole folder', () => {
		rememberList(2, false, { envelopes: [{ databaseId: 1 }, { databaseId: 2 }] })
		rememberList(2, false, { envelopes: [{ databaseId: 2 }] }, 'invoice')

		expect(recallList(2, false).envelopes).toHaveLength(2)
		expect(recallList(2, false, 'invoice').envelopes).toEqual([{ databaseId: 2 }])
		expect(recallList(2, false, 'other')).toBe(null)
	})

	it('remembers what was searched for in each folder, until it is cleared', () => {
		rememberSearch(2, 'invoice')
		rememberSearch(3, 'lunch')
		rememberSearch(3, '')

		expect(recallSearch(2)).toBe('invoice')
		expect(recallSearch('2')).toBe('invoice')
		expect(recallSearch(3)).toBe('')
		expect(recallSearch(4)).toBe('')
	})

	it('keeps only the 10 folders used last', () => {
		for (let id = 1; id <= 11; id++) {
			rememberList(id, false, { envelopes: [] })
		}
		// Using folder 2 again makes it recent; folder 1 was dropped
		rememberList(2, false, { scrollTop: 1 })
		rememberList(12, false, { envelopes: [] })

		expect(recallList(1, false)).toBe(null)
		expect(recallList(2, false)).not.toBe(null)
		expect(recallList(3, false)).toBe(null)
		expect(recallList(12, false)).not.toBe(null)
	})

	it('keeps only the 20 messages opened last', () => {
		for (let id = 1; id <= 21; id++) {
			rememberMessage(id, { subject: `Message ${id}` })
		}

		expect(recallMessage(1)).toBe(null)
		expect(recallMessage('21')).toEqual({ subject: 'Message 21' })
	})

	it('forgets a deleted message everywhere, search results too', () => {
		rememberMessage(5, { subject: 'Gone' })
		rememberList(2, false, { envelopes: [{ databaseId: 5 }, { databaseId: 6 }] })
		rememberList(3, true, { envelopes: [{ databaseId: 5 }] })
		rememberList(2, false, { envelopes: [{ databaseId: 5 }] }, 'gone')

		forgetMessage('5')

		expect(recallMessage(5)).toBe(null)
		expect(recallList(2, false).envelopes).toEqual([{ databaseId: 6 }])
		expect(recallList(3, true).envelopes).toEqual([])
		expect(recallList(2, false, 'gone').envelopes).toEqual([])
	})
})
