/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest'
import { REAUTH_KEY as API_KEY } from '../../src/api/mail.js'
import { REAUTH_KEY, REAUTH_MAX_AGE_MS, shouldReturn } from '../../src/reauth.js'

vi.mock('../../src/store.js', () => ({ store: {} }))

function memoryStorage(initial = {}) {
	const data = { ...initial }
	return {
		getItem: (key) => (key in data ? data[key] : null),
		setItem: (key, value) => { data[key] = String(value) },
		removeItem: (key) => { delete data[key] },
		data,
	}
}

describe('return to the phone page after signing in again', () => {
	it('uses the same marker the phone page leaves', () => {
		expect(REAUTH_KEY).toBe(API_KEY)
	})

	it('goes back when the marker is fresh, and removes it', () => {
		const storage = memoryStorage({ [REAUTH_KEY]: '1000' })
		expect(shouldReturn(storage, 1000 + 5000)).toBe(true)
		expect(storage.data[REAUTH_KEY]).toBeUndefined()
	})

	it('stays on the full app when the marker is old', () => {
		const storage = memoryStorage({ [REAUTH_KEY]: '1000' })
		expect(shouldReturn(storage, 1000 + REAUTH_MAX_AGE_MS + 1)).toBe(false)
		expect(storage.data[REAUTH_KEY]).toBeUndefined()
	})

	it('stays on the full app without a marker', () => {
		expect(shouldReturn(memoryStorage(), 5000)).toBe(false)
	})
})
