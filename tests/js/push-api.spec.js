/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkPushSubscription, deletePushSubscription, savePushSubscription } from '../../src/api/push.js'

const axiosMock = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
}))

vi.mock('@nextcloud/axios', () => ({ default: axiosMock }))

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/secret-device-token'

describe('push address never in a web address', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		axiosMock.post.mockResolvedValue({ data: { subscribed: true } })
		axiosMock.delete.mockResolvedValue({ data: {} })
	})

	it('sends it in the body when turning notifications off', async () => {
		await deletePushSubscription(ENDPOINT)

		const [url, config] = axiosMock.delete.mock.calls[0]
		expect(url).toBe('/index.php/apps/mail_mobile/push')
		expect(config).toEqual({ data: { endpoint: ENDPOINT } })
		expect(config.params).toBeUndefined()
	})

	it('sends it in the body when turning notifications on and when checking', async () => {
		await savePushSubscription(ENDPOINT, 'key', 'auth')
		await checkPushSubscription(ENDPOINT)

		for (const [url, body, config] of axiosMock.post.mock.calls) {
			expect(url).not.toContain('secret-device-token')
			expect(body.endpoint).toBe(ENDPOINT)
			expect(config?.params).toBeUndefined()
		}
	})
})
