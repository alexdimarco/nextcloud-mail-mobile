/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'
import EnvelopeList from '../../src/views/EnvelopeList.vue'
import Reader from '../../src/views/Reader.vue'
import { l10nMocks } from './l10n.js'

const storeMock = vi.hoisted(() => ({
	accounts: [],
	loading: false,
	loadError: false,
	currentEnvelope: null,
	authError: null,
	offline: false,
	buildVersion: '',
	version: '',
}))

// The folder shown; the refresh tests show one
const mailboxMock = vi.hoisted(() => ({ value: null }))

vi.mock('../../src/store.js', () => ({
	store: storeMock,
	loadAccounts: vi.fn(),
	defaultMailbox: () => mailboxMock.value,
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

describe('mobile App back arrow', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		storeMock.accounts = []
		window.history.replaceState(null, '', '#/')
	})

	function backButton(wrapper) {
		return wrapper.find('button[aria-label="Back"]')
	}

	it('goes to the message\'s folder when a notification opened the message', async () => {
		// A notification opens a fresh window straight on the message:
		// there is no earlier page to go back to
		window.history.replaceState(null, '', '#/msg/5/99')
		const historyBack = vi.spyOn(window.history, 'back')
		const length = window.history.length
		const wrapper = mountApp()

		await backButton(wrapper).trigger('click')

		expect(historyBack).not.toHaveBeenCalled()
		expect(window.location.hash).toBe('#/box/5')
		// Replaced, not added: the phone's back gesture does not return
		// to the message
		expect(window.history.length).toBe(length)
	})

	it('goes back normally after opening the message from inside the app', async () => {
		window.history.replaceState(null, '', '#/box/5')
		const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {})
		const wrapper = mountApp()

		wrapper.vm.go('#/msg/5/99')
		wrapper.vm.onHashChange()
		await wrapper.vm.$nextTick()
		await backButton(wrapper).trigger('click')

		expect(historyBack).toHaveBeenCalledTimes(1)
		expect(window.location.hash).toBe('#/msg/5/99')
	})

	it('does not mark the page as in-app when going to where it already is', () => {
		window.history.replaceState(null, '', '#/msg/5/99')
		const wrapper = mountApp()

		wrapper.vm.go('#/msg/5/99')

		expect(window.history.state).toBe(null)
	})

	it('goes to the main list from any other page with no earlier entry', async () => {
		window.history.replaceState(null, '', '#/boxes')
		const wrapper = mountApp()

		await backButton(wrapper).trigger('click')

		expect(window.location.hash).toBe('#/')
	})
})

describe('mobile App with no connection to the server', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		storeMock.accounts = [{ id: 1, emailAddress: 'me@example.com', mailboxes: [] }]
		storeMock.loadError = false
		storeMock.offline = true
	})

	it('says so, and Try again asks Mail again for what is on screen', async () => {
		const wrapper = mountApp()
		expect(wrapper.text()).toContain('No connection to the server. Showing what was already loaded.')

		await wrapper.find('.mob__banner .mob__retry').trigger('click')

		expect(wrapper.vm.refreshTick).toBe(1)
		const { loadAccounts } = await import('../../src/store.js')
		expect(loadAccounts).not.toHaveBeenCalled()
	})

	it('loads the accounts again too when they did not all load', async () => {
		storeMock.accounts = [{ id: 1, emailAddress: 'me@example.com', mailboxes: [], error: true }]
		const wrapper = mountApp()

		await wrapper.find('.mob__banner .mob__retry').trigger('click')

		const { loadAccounts } = await import('../../src/store.js')
		expect(loadAccounts).toHaveBeenCalledTimes(1)
	})

	it('leaves it to the page when the accounts could not be loaded at all', () => {
		storeMock.accounts = []
		storeMock.loadError = true
		const wrapper = mountApp()

		expect(wrapper.text()).not.toContain('No connection to the server')
		expect(wrapper.text()).toContain('Could not load your mail accounts.')
	})

	it('shows nothing when the connection works', () => {
		storeMock.offline = false
		const wrapper = mountApp()

		expect(wrapper.text()).not.toContain('No connection to the server')
	})
})

describe('mobile App while a message is being written', () => {
	// Stands in for the compose screen: something written, or not
	function composerStub(hasWork) {
		return {
			name: 'Composer',
			data: () => ({ hasWork, discarded: false }),
			methods: {
				discard() {
					this.discarded = true
					this.hasWork = false
				},
			},
			render: (h) => h('div'),
		}
	}

	async function mountComposing(hasWork) {
		window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
		const wrapper = shallowMount(App, { mocks: l10nMocks, stubs: { Composer: composerStub(hasWork) } })
		wrapper.vm.go('#/compose')
		wrapper.vm.onHashChange()
		await wrapper.vm.$nextTick()
		return wrapper
	}

	beforeEach(() => {
		vi.restoreAllMocks()
		storeMock.accounts = []
		storeMock.composerPrefill = null
		window.sessionStorage.clear()
		window.history.replaceState(null, '', '#/box/5')
	})

	it('asks before the back arrow throws it away', async () => {
		const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {})
		const wrapper = await mountComposing(true)

		await wrapper.find('button[aria-label="Back"]').trigger('click')

		expect(wrapper.find('.mob__confirm').text()).toContain('Discard this message?')
		expect(historyBack).not.toHaveBeenCalled()
		expect(wrapper.vm.route.view).toBe('compose')
	})

	it('"Keep writing" stays on the message', async () => {
		const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {})
		const wrapper = await mountComposing(true)
		await wrapper.find('button[aria-label="Back"]').trigger('click')

		await wrapper.findAll('.mob__confirm button').at(0).trigger('click')

		expect(wrapper.find('.mob__confirm').exists()).toBe(false)
		expect(historyBack).not.toHaveBeenCalled()
	})

	it('"Discard" throws it away and goes back', async () => {
		const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {})
		const wrapper = await mountComposing(true)
		await wrapper.find('button[aria-label="Back"]').trigger('click')

		await wrapper.findAll('.mob__confirm button').at(1).trigger('click')

		expect(wrapper.vm.$refs.composer.discarded).toBe(true)
		expect(wrapper.find('.mob__confirm').exists()).toBe(false)
		expect(historyBack).toHaveBeenCalledTimes(1)
	})

	it('goes back without asking when nothing was written', async () => {
		const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {})
		const wrapper = await mountComposing(false)

		await wrapper.find('button[aria-label="Back"]').trigger('click')

		expect(wrapper.find('.mob__confirm').exists()).toBe(false)
		expect(historyBack).toHaveBeenCalledTimes(1)
	})

	it('the phone\'s back gesture stays on the message and asks; Discard then goes back', async () => {
		const wrapper = await mountComposing(true)
		const pushState = vi.spyOn(window.history, 'pushState')
		const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {})

		// The browser already moved back to the list
		window.history.replaceState(null, '', '#/box/5')
		wrapper.vm.onHashChange()
		await wrapper.vm.$nextTick()

		expect(wrapper.vm.route.view).toBe('compose')
		expect(pushState).toHaveBeenCalledWith({ mailMobile: true }, '', '#/compose')
		expect(window.location.hash).toBe('#/compose')
		expect(wrapper.find('.mob__confirm').exists()).toBe(true)

		await wrapper.findAll('.mob__confirm button').at(1).trigger('click')
		expect(historyBack).toHaveBeenCalledTimes(1)

		// The browser goes back to the list: now it is let through
		window.history.replaceState(null, '', '#/box/5')
		wrapper.vm.onHashChange()
		expect(wrapper.vm.route.view).toBe('list')
	})

	it('opens a message kept while the page reloaded', async () => {
		const { keepDraft } = await import('../../src/draft.js')
		keepDraft({ to: 'sam@example.com', editorHtml: '<div>Hi</div>' })

		const wrapper = mountApp()

		expect(storeMock.composerPrefill.kept).toMatchObject({ to: 'sam@example.com', editorHtml: '<div>Hi</div>' })
		expect(wrapper.vm.route.view).toBe('compose')
		expect(window.location.hash).toBe('#/compose')
		expect(window.sessionStorage.length).toBe(0)
	})

	it('waits for the accounts before showing the message, so its sender is there', async () => {
		storeMock.loading = true
		const wrapper = await mountComposing(true)
		expect(wrapper.findComponent({ name: 'Composer' }).exists()).toBe(false)
		expect(wrapper.find('.mob__detail').text()).toContain('Loading your mail')

		storeMock.loading = false
		await wrapper.vm.$forceUpdate()
		await wrapper.vm.$nextTick()
		expect(wrapper.findComponent({ name: 'Composer' }).exists()).toBe(true)
	})

	it('opens the list as usual when no message was kept', () => {
		const wrapper = mountApp()

		expect(wrapper.vm.route.view).toBe('list')
		expect(storeMock.composerPrefill).toBe(null)
	})
})

describe('mobile App opening a folder from the list of folders', () => {
	it('starts it unsearched', async () => {
		const { recallSearch, rememberSearch } = await import('../../src/memory.js')
		window.history.replaceState(null, '', '#/boxes')
		rememberSearch(7, 'invoice')
		const wrapper = mountApp()

		wrapper.vm.openMailbox({ databaseId: 7 })

		expect(recallSearch(7)).toBe('')
		expect(window.location.hash).toBe('#/box/7')
	})
})

describe('mobile App refresh button', () => {
	const INBOX = { databaseId: 2, accountId: 1, displayName: 'Inbox', accountEmail: 'me@example.com' }

	function refreshButton(wrapper) {
		return wrapper.find('[aria-label="Refresh"]')
	}

	function turning(wrapper) {
		return refreshButton(wrapper).classes().includes('mob__icon-btn--busy')
	}

	async function flush(wrapper) {
		for (let i = 0; i < 4; i++) {
			await wrapper.vm.$nextTick()
		}
	}

	beforeEach(() => {
		vi.useFakeTimers()
		window.history.replaceState(null, '', '#/')
		storeMock.accounts = [{ id: 1, emailAddress: 'me@example.com', mailboxes: [INBOX] }]
		mailboxMock.value = INBOX
	})

	afterEach(() => {
		vi.useRealTimers()
		mailboxMock.value = null
		storeMock.accounts = []
	})

	it('turns while the list checks for new mail, then says it is up to date', async () => {
		const wrapper = mountApp()
		const list = wrapper.findComponent(EnvelopeList)
		expect(turning(wrapper)).toBe(false)

		await refreshButton(wrapper).trigger('click')

		expect(list.props('refreshTick')).toBe(1)
		expect(turning(wrapper)).toBe(true)
		expect(refreshButton(wrapper).attributes('aria-busy')).toBe('true')

		// A quick check: the button still turns for a moment, then says so
		list.vm.$emit('refreshed', true)
		await flush(wrapper)
		expect(turning(wrapper)).toBe(true)
		expect(wrapper.find('.mob__toast').exists()).toBe(false)

		vi.advanceTimersByTime(700)
		await flush(wrapper)
		expect(turning(wrapper)).toBe(false)
		expect(wrapper.find('[role="status"]').text()).toBe('Up to date')

		vi.advanceTimersByTime(2500)
		await flush(wrapper)
		expect(wrapper.find('.mob__toast').exists()).toBe(false)
	})

	it('says so when checking for new mail did not work', async () => {
		const wrapper = mountApp()

		await refreshButton(wrapper).trigger('click')
		wrapper.findComponent(EnvelopeList).vm.$emit('refreshed', false)
		vi.advanceTimersByTime(700)
		await flush(wrapper)

		expect(wrapper.find('.mob__toast').text()).toBe('Could not check for new mail')
	})

	it('turns as long as the list is busy, also for a check it did not start', async () => {
		const wrapper = mountApp()
		const list = wrapper.findComponent(EnvelopeList)

		list.vm.$emit('busy', true)
		await flush(wrapper)
		expect(turning(wrapper)).toBe(true)

		list.vm.$emit('busy', false)
		list.vm.$emit('refreshed', true)
		vi.advanceTimersByTime(700)
		await flush(wrapper)
		expect(turning(wrapper)).toBe(false)
		// Only a check the button started is reported
		expect(wrapper.find('.mob__toast').exists()).toBe(false)
	})

	it('reports nothing later when the list went away before its check finished', async () => {
		const wrapper = mountApp()
		const list = wrapper.findComponent(EnvelopeList)

		await refreshButton(wrapper).trigger('click')
		// The list says it is no longer busy as it goes away
		list.vm.$emit('busy', false)
		// A later check started by the page itself
		list.vm.$emit('refreshed', true)
		vi.advanceTimersByTime(700)
		await flush(wrapper)

		expect(wrapper.find('.mob__toast').exists()).toBe(false)
	})

	it('has the list read its pinned messages again after one was pinned', async () => {
		window.history.replaceState(null, '', '#/msg/2/9')
		const wrapper = mountApp()

		wrapper.findComponent(Reader).vm.$emit('pinned', true)

		expect(wrapper.vm.listTick).toBe(1)
		expect(wrapper.vm.refreshTick).toBe(0)
	})
})
