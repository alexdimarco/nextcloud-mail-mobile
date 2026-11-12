/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MailboxPicker from '../../src/views/MailboxPicker.vue'

const push = vi.hoisted(() => ({
	checkPushSubscription: vi.fn(),
	deletePushSubscription: vi.fn(),
	getPushKey: vi.fn(),
	savePushPreferences: vi.fn(),
	savePushSubscription: vi.fn(),
	sendTestPush: vi.fn(),
}))
vi.mock('../../src/api/push.js', () => push)

const storeMock = vi.hoisted(() => ({
	accounts: [],
	isStandalone: true,
	showDetails: false,
	sourceUrl: '',
	swUrl: '/apps/mail_mobile/sw.js',
	swScope: '/apps/mail_mobile/',
	iconUrl: '/apps/mail_mobile/img/icon-192.png',
}))
vi.mock('../../src/store.js', () => ({ store: storeMock }))

function browserSubscription(endpoint) {
	return {
		endpoint,
		unsubscribe: vi.fn().mockResolvedValue(true),
		toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
	}
}

function fakeBrowser(existing) {
	const registration = {
		pushManager: {
			getSubscription: vi.fn().mockResolvedValue(existing),
			subscribe: vi.fn(),
		},
	}
	window.PushManager = function() {}
	Object.defineProperty(window.navigator, 'serviceWorker', {
		configurable: true,
		value: {
			getRegistration: vi.fn().mockResolvedValue(registration),
			register: vi.fn().mockResolvedValue(registration),
			ready: Promise.resolve(registration),
		},
	})
	window.Notification = { requestPermission: vi.fn().mockResolvedValue('granted') }
	return registration
}

async function mountPicker() {
	const wrapper = shallowMount(MailboxPicker, { mocks: { t: (app, text) => text } })
	await new Promise((resolve) => setTimeout(resolve, 0))
	return wrapper
}

describe('mobile notifications on a shared or signed-out browser', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		storeMock.showDetails = false
	})

	it('keeps notifications on when the server confirms they are this person\'s', async () => {
		const existing = browserSubscription('https://fcm.googleapis.com/fcm/send/mine')
		fakeBrowser(existing)
		push.checkPushSubscription.mockResolvedValue(true)

		const wrapper = await mountPicker()

		expect(push.checkPushSubscription).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/mine')
		expect(existing.unsubscribe).not.toHaveBeenCalled()
		expect(wrapper.vm.pushEnabled).toBe(true)
	})

	it('drops a subscription that belongs to someone else or was removed', async () => {
		const existing = browserSubscription('https://fcm.googleapis.com/fcm/send/theirs')
		fakeBrowser(existing)
		push.checkPushSubscription.mockResolvedValue(false)

		const wrapper = await mountPicker()

		expect(existing.unsubscribe).toHaveBeenCalledTimes(1)
		expect(wrapper.vm.pushEnabled).toBe(false)
	})

	it('asks the browser for a fresh address when the old one is another user\'s', async () => {
		const old = browserSubscription('https://fcm.googleapis.com/fcm/send/theirs')
		const fresh = browserSubscription('https://fcm.googleapis.com/fcm/send/new')
		const registration = fakeBrowser(null)
		registration.pushManager.subscribe.mockResolvedValueOnce(old).mockResolvedValueOnce(fresh)
		push.getPushKey.mockResolvedValue('BAAA')
		const conflict = Object.assign(new Error('conflict'), { response: { status: 409 } })
		push.savePushSubscription.mockRejectedValueOnce(conflict).mockResolvedValueOnce(undefined)

		const wrapper = await mountPicker()
		await wrapper.vm.togglePush()

		expect(old.unsubscribe).toHaveBeenCalledTimes(1)
		expect(push.savePushSubscription).toHaveBeenLastCalledWith('https://fcm.googleapis.com/fcm/send/new', 'p', 'a')
		expect(wrapper.vm.pushEnabled).toBe(true)
		// The worker is registered with the icon address, which cron cannot know
		expect(window.navigator.serviceWorker.register).toHaveBeenCalledWith(
			'/apps/mail_mobile/sw.js?icon=%2Fapps%2Fmail_mobile%2Fimg%2Ficon-192.png',
			{ scope: '/apps/mail_mobile/' },
		)
	})

	it('saves the choice to show sender and subject', async () => {
		fakeBrowser(null)
		const wrapper = await mountPicker()

		await wrapper.vm.saveShowDetails(true)

		expect(push.savePushPreferences).toHaveBeenCalledWith(true)
		expect(storeMock.showDetails).toBe(true)
	})
})
