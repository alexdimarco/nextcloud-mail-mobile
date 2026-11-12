/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/* Service worker for the phone page: shows web push notifications and
 * focuses or opens the page when one is tapped. Its scope is the phone
 * page's own address, which the server works out (with or without
 * /index.php/), so nothing here hard-codes a path. Notifications carry
 * only the part of the address after "#"; it is resolved here against the
 * scope, so a notification can never open another site. */

import { iconFromWorkerUrl, notificationTarget } from './swTargets.js'

const ICON = iconFromWorkerUrl(self.location.href)

self.addEventListener('push', (event) => {
	let data
	try {
		data = event.data ? event.data.json() : {}
	} catch {
		data = { title: 'Mail Mobile', body: event.data ? event.data.text() : '' }
	}
	event.waitUntil(self.registration.showNotification(data.title || 'Mail Mobile', {
		body: data.body || '',
		tag: data.tag,
		data: { url: data.url },
		icon: ICON,
	}))
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	const scope = self.registration.scope
	const target = notificationTarget(event.notification.data && event.notification.data.url, scope)
	event.waitUntil((async () => {
		const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
		for (const client of windows) {
			if (client.url.startsWith(scope)) {
				await client.focus()
				if ('navigate' in client) {
					await client.navigate(target)
				}
				return
			}
		}
		await self.clients.openWindow(target)
	})())
})
