/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/* Service worker for the phone page: shows web push notifications and
 * focuses or opens the page when one is tapped. Its scope is the phone
 * page's own address, which the server works out (with or without
 * /index.php/), so nothing here hard-codes a path. */

self.addEventListener('push', (event) => {
	let data
	try {
		data = event.data ? event.data.json() : {}
	} catch {
		data = { title: 'Mail', body: event.data ? event.data.text() : '' }
	}
	event.waitUntil(self.registration.showNotification(data.title || 'Mail', {
		body: data.body || '',
		tag: data.tag,
		data,
		icon: data.icon,
	}))
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	const url = event.notification.data && event.notification.data.url
	event.waitUntil((async () => {
		const scope = self.registration.scope
		const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
		for (const client of windows) {
			if (client.url.startsWith(scope)) {
				await client.focus()
				if (url && 'navigate' in client) {
					await client.navigate(url)
				}
				return
			}
		}
		await self.clients.openWindow(url || scope)
	})())
})
