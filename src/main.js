/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getRequestToken } from '@nextcloud/auth'
import { translatePlural as n, translate as t } from '@nextcloud/l10n'
import { generateFilePath } from '@nextcloud/router'
import Vue from 'vue'
import App from './App.vue'
import { REAUTH_KEY } from './api/mail.js'
import { loadAccounts, store } from './store.js'

__webpack_nonce__ = btoa(getRequestToken())

__webpack_public_path__ = generateFilePath('mail_mobile', '', 'js/')

// Chrome on Android offers a native install prompt we can show from a button
window.addEventListener('beforeinstallprompt', (event) => {
	event.preventDefault()
	store.installPrompt = event
})

Vue.mixin({ methods: { t, n } })

// We reached the phone page: clear any re-login marker so a later visit
// to the full Mail app is not sent back here.
try {
	window.localStorage.removeItem(REAUTH_KEY)
} catch {
	// localStorage unavailable: ignore
}

loadAccounts()

const View = Vue.extend(App)
new View({}).$mount('#mail-mobile')
