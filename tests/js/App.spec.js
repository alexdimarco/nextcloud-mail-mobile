/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'

const storeMock = vi.hoisted(() => ({
	accounts: [],
	loading: false,
	loadError: false,
	currentEnvelope: null,
	authError: null,
	buildVersion: '',
	version: '',
}))

vi.mock('../../src/store.js', () => ({
	store: storeMock,
	loadAccounts: vi.fn(),
	defaultMailbox: () => null,
	findMailbox: () => null,
}))

function mountApp() {
	window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
	return shallowMount(App, { mocks: { t: (app, text) => text } })
}

describe('mobile App when no folder could be shown', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		storeMock.accounts = []
		storeMock.loading = false
		storeMock.loadError = false
	})

	it('offers to try again when an account\'s folders failed to load', async () => {
		// Seen on a first sign-in: one failed request for the folder list
		// left the page saying "No mailbox found" with no way out
		storeMock.accounts = [{ id: 1, emailAddress: 'me@example.com', mailboxes: [], error: true }]
		const wrapper = mountApp()
		expect(wrapper.text()).toContain('Could not load your mail folders.')
		expect(wrapper.text()).not.toContain('No mailbox found')

		const { loadAccounts } = await import('../../src/store.js')
		await wrapper.find('.mob__retry').trigger('click')
		expect(loadAccounts).toHaveBeenCalledTimes(1)
	})

	it('still says plainly when an account has no folders at all', () => {
		storeMock.accounts = [{ id: 1, emailAddress: 'me@example.com', mailboxes: [] }]
		const wrapper = mountApp()
		expect(wrapper.text()).toContain('No mailbox found')
		expect(wrapper.find('.mob__retry').exists()).toBe(false)
	})
})
