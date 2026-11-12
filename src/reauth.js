/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Added to the full Mail app's page only (see MailPageScriptListener.php).
// After a session ran out on the phone page, single sign-on can land the
// person on the full Mail app instead of back on the phone page. The phone
// page leaves a short-lived marker before reloading; if it is here, go back.

import { generateUrl } from '@nextcloud/router'

export const REAUTH_KEY = 'mail_mobile-reauth'
export const REAUTH_MAX_AGE_MS = 2 * 60 * 1000

/**
 * @param {Storage} storage where the marker lives
 * @param {number} now the current time in milliseconds
 * @return {boolean} whether to go back to the phone page
 */
export function shouldReturn(storage, now) {
	const marker = storage.getItem(REAUTH_KEY)
	if (!marker) {
		return false
	}
	storage.removeItem(REAUTH_KEY)
	const age = now - Number(marker)
	return age >= 0 && age < REAUTH_MAX_AGE_MS
}

try {
	if (shouldReturn(window.localStorage, Date.now())) {
		window.location.replace(generateUrl('/apps/mail_mobile/'))
	}
} catch {
	// localStorage unavailable: load the full app normally
}
