/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { iconFromWorkerUrl, notificationTarget } from '../../src/swTargets.js'

const SCOPE = 'https://cloud.example/index.php/apps/mail_mobile/'

describe('where a tapped notification goes', () => {
	it('resolves the part after # against the phone page', () => {
		expect(notificationTarget('#/msg/12/345', SCOPE)).toBe(SCOPE + '#/msg/12/345')
	})

	it('opens the phone page when there is no address', () => {
		expect(notificationTarget(undefined, SCOPE)).toBe(SCOPE)
		expect(notificationTarget('', SCOPE)).toBe(SCOPE)
		expect(notificationTarget({ url: 'x' }, SCOPE)).toBe(SCOPE)
	})

	it('never leaves this server or the phone page', () => {
		expect(notificationTarget('https://evil.example/#/msg/1/2', SCOPE)).toBe(SCOPE)
		expect(notificationTarget('//evil.example/x', SCOPE)).toBe(SCOPE)
		expect(notificationTarget('javascript:alert(1)', SCOPE)).toBe(SCOPE)
		expect(notificationTarget('/index.php/apps/files/', SCOPE)).toBe(SCOPE)
		expect(notificationTarget('http://localhost/index.php/apps/mail_mobile/#/box/1', SCOPE)).toBe(SCOPE)
	})
})

describe('the notification icon', () => {
	it('reads a same-server icon from the worker address', () => {
		const worker = 'https://cloud.example/index.php/apps/mail_mobile/sw.js?icon=' + encodeURIComponent('/custom_apps/mail_mobile/img/icon-192.png')
		expect(iconFromWorkerUrl(worker)).toBe('https://cloud.example/custom_apps/mail_mobile/img/icon-192.png')
	})

	it('ignores a missing or foreign icon', () => {
		expect(iconFromWorkerUrl('https://cloud.example/apps/mail_mobile/sw.js')).toBeUndefined()
		expect(iconFromWorkerUrl('https://cloud.example/sw.js?icon=' + encodeURIComponent('https://evil.example/i.png'))).toBeUndefined()
	})
})
