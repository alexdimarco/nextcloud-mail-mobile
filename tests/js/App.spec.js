/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'
import { l10nMocks } from './l10n.js'

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
	return shallowMount(App, { mocks: l10nMocks })
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

describe('mobile App with a Mail 6 account whose sign-in expired', () => {
	beforeEach(() => {
		storeMock.loading = false
		storeMock.loadError = false
	})

	it('says which account must be reconnected and links to the full Mail app', () => {
		storeMock.accounts = [
			{ id: 1, emailAddress: 'me@example.com', mailboxes: [], oauthNeedsReauth: true },
			{ id: 2, emailAddress: 'other@example.com', mailboxes: [], oauthNeedsReauth: false },
		]
		const wrapper = mountApp()
		const banners = wrapper.findAll('.mob__banner')
		expect(banners).toHaveLength(1)
		expect(banners.at(0).text()).toContain('The sign-in for me@example.com expired')
		expect(banners.at(0).text()).not.toContain('other@example.com')
		expect(banners.at(0).find('a').attributes('href')).toContain('/apps/mail/')
	})

	it('shows an address with an apostrophe or & exactly as it is', () => {
		// The real t() escapes inserted values unless told the result is
		// text; Vue escapes {{ }} again, which showed o&#39;brien+a&amp;b
		storeMock.accounts = [{ id: 1, emailAddress: "o'brien+a&b@example.com", mailboxes: [], oauthNeedsReauth: true }]
		const banner = mountApp().find('.mob__banner')
		expect(banner.text()).toContain("The sign-in for o'brien+a&b@example.com expired")
		expect(banner.text()).not.toContain('&amp;')
		expect(banner.text()).not.toContain('&#39;')
	})

	it('shows an address that looks like HTML as text, never as markup', () => {
		storeMock.accounts = [{ id: 1, emailAddress: '<img src=x onerror=alert(1)>@example.com', mailboxes: [], oauthNeedsReauth: true }]
		const banner = mountApp().find('.mob__banner')
		expect(banner.text()).toContain('<img src=x onerror=alert(1)>@example.com')
		expect(banner.find('img').exists()).toBe(false)
	})

	it('tells someone an account was shared with that only its owner can reconnect it', () => {
		// Mail lists accounts others delegated to you with isDelegated;
		// their sign-in is the owner's, so "Reconnect" is not offered
		storeMock.accounts = [{ id: 3, emailAddress: 'boss@example.com', mailboxes: [], oauthNeedsReauth: true, isDelegated: true }]
		const banner = mountApp().find('.mob__banner')
		expect(banner.text()).toContain('The sign-in for boss@example.com expired')
		expect(banner.text()).toContain('only they can reconnect it')
		expect(banner.text()).not.toContain('choose Reconnect')
		expect(banner.find('a').exists()).toBe(false)
	})

	it('uses a t() that escapes like Nextcloud\'s, so double escaping shows up here', () => {
		expect(l10nMocks.t('mail_mobile', 'Hi {name}', { name: "o'brien & <b>" })).toBe('Hi o&#39;brien &amp; &lt;b&gt;')
	})

	it('shows nothing extra for Mail 5 accounts, which have no such field', () => {
		storeMock.accounts = [{ id: 1, emailAddress: 'me@example.com', mailboxes: [] }]
		const wrapper = mountApp()
		expect(wrapper.findAll('.mob__banner')).toHaveLength(0)
	})
})
