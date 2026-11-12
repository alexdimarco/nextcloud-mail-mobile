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

export async function deletePushSubscription(endpoint) {
	await axios.delete(generateUrl('/apps/mail_mobile/push'), { params: { endpoint } })
}

export async function sendTestPush() {
	const resp = await axios.post(generateUrl('/apps/mail_mobile/push/test'))
	return resp.data?.delivered ?? 0
}
