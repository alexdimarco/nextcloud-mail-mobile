/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Calls to this app's own server routes (notifications)

import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'

export async function getPushKey() {
	const resp = await axios.get(generateUrl('/apps/mail_mobile/push/key'))
	return resp.data.publicKey
}

export async function savePushSubscription(endpoint, p256dh, auth) {
	await axios.post(generateUrl('/apps/mail_mobile/push'), { endpoint, p256dh, auth })
}

/**
 * Whether this browser's push address is registered to the person signed
 * in now. False after they signed out (or someone else used this browser),
 * after a password change, or after the device was removed in settings.
 *
 * @param {string} endpoint the browser's push address
 * @return {Promise<boolean>} whether it is theirs
 */
export async function checkPushSubscription(endpoint) {
	const resp = await axios.post(generateUrl('/apps/mail_mobile/push/check'), { endpoint })
	return resp.data?.subscribed === true
}

/**
 * @param {boolean} showDetails show sender and subject in notifications
 */
export async function savePushPreferences(showDetails) {
	await axios.put(generateUrl('/apps/mail_mobile/push/preferences'), { showDetails })
}

export async function deletePushSubscription(endpoint) {
	await axios.delete(generateUrl('/apps/mail_mobile/push'), { params: { endpoint } })
}

export async function sendTestPush() {
	const resp = await axios.post(generateUrl('/apps/mail_mobile/push/test'))
	return resp.data?.delivered ?? 0
}
