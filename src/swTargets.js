/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Address checks for the service worker (src/sw.js), kept apart so they
// can be tested. A notification only ever opens a page inside the phone
// page's own scope, and only shows an icon from this same server.

/**
 * Where tapping a notification goes. The server sends only the part after
 * "#" (for example "#/msg/12/345"); it is resolved against the service
 * worker's scope. Anything that would lead outside the scope opens the
 * phone page itself instead.
 *
 * @param {unknown} url the url from the notification's data
 * @param {string} scope the service worker's scope (an absolute address)
 * @return {string} the absolute address to open
 */
export function notificationTarget(url, scope) {
	const base = new URL(scope)
	if (typeof url !== 'string' || url === '') {
		return base.href
	}
	let target
	try {
		target = new URL(url, base)
	} catch {
		return base.href
	}
	if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
		return base.href
	}
	return target.href
}

/**
 * The notification icon, passed to the service worker as "?icon=" when the
 * phone page registers it. Only an address on this same server is used.
 *
 * @param {string} workerUrl the service worker's own address
 * @return {string|undefined} the icon address, or undefined for none
 */
export function iconFromWorkerUrl(workerUrl) {
	try {
		const own = new URL(workerUrl)
		const icon = own.searchParams.get('icon')
		if (!icon) {
			return undefined
		}
		const resolved = new URL(icon, own)
		return resolved.origin === own.origin ? resolved.href : undefined
	} catch {
		return undefined
	}
}
