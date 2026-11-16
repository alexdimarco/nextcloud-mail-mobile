<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="picker">
		<section v-for="account in store.accounts" :key="account.id" class="picker__account">
			<h2 class="picker__email">
				{{ account.emailAddress }}
			</h2>
			<p v-if="account.error" class="picker__error">
				{{ t('mail_mobile', 'This account cannot connect right now') }}
			</p>
			<button
				v-for="mailbox in sorted(account.mailboxes)"
				:key="mailbox.databaseId"
				class="picker__box"
				@click="$emit('open', mailbox)">
				<span class="picker__box-icon">{{ iconFor(mailbox) }}</span>
				<span class="picker__box-name">{{ mailbox.displayName }}</span>
				<span v-if="mailbox.unread" class="picker__badge">{{ mailbox.unread }}</span>
			</button>
		</section>
		<div v-if="!store.isStandalone" class="picker__install">
			<button class="picker__install-btn" @click="install">
				📲 {{ t('mail_mobile', 'Save to home screen') }}
			</button>
			<p v-if="showInstallHelp" class="picker__install-help">
				<template v-if="isIos">
					{{ t('mail_mobile', 'In Safari: tap the Share button, then "Add to Home Screen". The mail icon will appear like an app.') }}
				</template>
				<template v-else>
					{{ t('mail_mobile', 'Open the browser menu (⋮) and choose "Add to Home screen". The mail icon will appear like an app.') }}
				</template>
			</p>
		</div>
		<div v-if="pushSupported" class="picker__install">
			<button
				class="picker__install-btn picker__push-btn"
				:disabled="pushBusy"
				@click="togglePush">
				🔔 {{ pushEnabled ? t('mail_mobile', 'Disable notifications') : t('mail_mobile', 'Enable notifications') }}
			</button>
			<button
				v-if="pushEnabled"
				class="picker__install-btn picker__push-btn"
				@click="testPush">
				{{ t('mail_mobile', 'Send test notification') }}
			</button>
			<label v-if="pushEnabled" class="picker__details">
				<input
					type="checkbox"
					:checked="store.showDetails"
					@change="saveShowDetails($event.target.checked)">
				{{ t('mail_mobile', 'Show sender and subject in notifications') }}
			</label>
			<p v-if="pushEnabled" class="picker__install-help">
				{{ store.showDetails
					? t('mail_mobile', 'Anyone who sees your locked phone can read who wrote and what about.')
					: t('mail_mobile', 'Notifications only say "New mail", so your lock screen shows nothing private.') }}
			</p>
			<p v-if="pushHint" class="picker__install-help">
				{{ pushHint }}
			</p>
		</div>
		<a class="picker__full" :href="fullAppUrl">
			{{ t('mail_mobile', 'Open the full Mail app') }}
		</a>
		<a
			v-if="store.sourceUrl"
			class="picker__source"
			:href="store.sourceUrl"
			target="_blank"
			rel="noopener noreferrer">
			{{ t('mail_mobile', 'Source code') }}
		</a>
		<p v-if="store.buildVersion || store.version" class="picker__version">
			Mail Mobile {{ store.buildVersion || store.version }}<template v-if="store.mailVersion">
				· Mail {{ store.mailVersion }}
			</template>
			<template v-if="store.buildVersion && store.version && store.buildVersion !== store.version">
				<br>({{ t('mail_mobile', 'server has {version} — reload to update', { version: store.version }, AS_TEXT) }})
			</template>
		</p>
	</div>
</template>

<script>
import { generateUrl } from '@nextcloud/router'
import {
	checkPushSubscription,
	deletePushSubscription,
	getPushKey,
	savePushPreferences,
	savePushSubscription,
	sendTestPush,
} from '../api/push.js'
import { AS_TEXT } from '../l10nText.js'
import logger from '../logger.js'
import { store } from '../store.js'

/**
 * @param {string} base64 the VAPID public key
 * @return {Uint8Array} the applicationServerKey bytes
 */
function urlBase64ToUint8Array(base64) {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4)
	const raw = window.atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
	return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

// The service worker's address and scope come from the server, which
// knows whether this server's addresses include /index.php/
const swScope = () => store.swScope || generateUrl('/apps/mail_mobile/')
// The icon address rides along, because notifications are sent from a
// background job that cannot reliably work out this server's address
/**
 * @return {string} the service worker's address, with the icon address
 */
function swUrl() {
	const url = store.swUrl || generateUrl('/apps/mail_mobile/sw.js')
	return store.iconUrl ? url + '?icon=' + encodeURIComponent(store.iconUrl) : url
}

const ROLE_ORDER = { inbox: 0, drafts: 1, sent: 2, archive: 3, junk: 4, trash: 5 }
const ROLE_ICONS = { inbox: '📥', drafts: '📝', sent: '📤', archive: '📦', junk: '🚫', trash: '🗑' }

export default {
	name: 'MailboxPicker',
	data() {
		return {
			AS_TEXT,
			store,
			fullAppUrl: generateUrl('/apps/mail/'),
			showInstallHelp: false,
			pushEnabled: false,
			pushBusy: false,
			pushHint: null,
		}
	},

	computed: {
		isIos() {
			return /iPad|iPhone|iPod/.test(window.navigator.userAgent)
				|| (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
		},

		pushSupported() {
			return 'serviceWorker' in window.navigator && 'PushManager' in window
		},
	},

	async mounted() {
		if (!this.pushSupported) {
			return
		}
		let subscription
		try {
			const registration = await window.navigator.serviceWorker.getRegistration(swScope())
			subscription = await registration?.pushManager.getSubscription()
		} catch (error) {
			logger.debug('could not determine push subscription state', error)
			return
		}
		if (!subscription) {
			this.pushEnabled = false
			return
		}
		// The browser remembers the subscription, but it may belong to
		// someone who signed out, or have been removed in settings: then
		// this browser must stop receiving it
		try {
			if (await checkPushSubscription(subscription.endpoint)) {
				this.pushEnabled = true
				return
			}
			await subscription.unsubscribe()
			this.pushEnabled = false
		} catch (error) {
			logger.debug('could not check the push subscription with the server', error)
			this.pushEnabled = true
		}
	},

	methods: {
		async togglePush() {
			this.pushBusy = true
			this.pushHint = null
			try {
				if (this.pushEnabled) {
					const registration = await window.navigator.serviceWorker.getRegistration(swScope())
					const subscription = await registration?.pushManager.getSubscription()
					if (subscription) {
						await deletePushSubscription(subscription.endpoint)
						await subscription.unsubscribe()
					}
					this.pushEnabled = false
					return
				}

				if (this.isIos && !this.store.isStandalone) {
					this.pushHint = this.t('mail_mobile', 'Save this page to your home screen first — iPhone and iPad only allow notifications for installed web apps.')
					return
				}
				const permission = await window.Notification.requestPermission()
				if (permission !== 'granted') {
					this.pushHint = this.t('mail_mobile', 'The browser did not allow notifications.')
					return
				}
				const registration = await window.navigator.serviceWorker.register(
					swUrl(),
					{ scope: swScope() },
				)
				await window.navigator.serviceWorker.ready
				const key = await getPushKey()
				const subscription = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(key),
				})
				await this.saveSubscription(registration, subscription, key)
				this.pushEnabled = true
				this.pushHint = this.t('mail_mobile', 'Notifications enabled. New mail is announced after Mail\'s next background check, which can take from a few minutes to an hour.')
			} catch (error) {
				logger.error('could not toggle push notifications', error)
				this.pushHint = error.response?.status === 503
					? this.t('mail_mobile', 'Notifications are not set up on this server yet. Ask your administrator.')
					: this.t('mail_mobile', 'Could not enable notifications.')
			} finally {
				this.pushBusy = false
			}
		},

		/**
		 * Store the subscription on the server. If the server says the
		 * address is registered to someone else (an earlier user of this
		 * browser), drop it and ask the browser for a fresh one.
		 *
		 * @param {ServiceWorkerRegistration} registration the worker registration
		 * @param {PushSubscription} subscription the browser's subscription
		 * @param {string} key the server's public key
		 */
		async saveSubscription(registration, subscription, key) {
			const save = (sub) => {
				const json = sub.toJSON()
				return savePushSubscription(sub.endpoint, json.keys.p256dh, json.keys.auth)
			}
			try {
				await save(subscription)
			} catch (error) {
				if (error.response?.status !== 409) {
					throw error
				}
				await subscription.unsubscribe()
				const fresh = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(key),
				})
				await save(fresh)
			}
		},

		async saveShowDetails(value) {
			const before = this.store.showDetails
			this.store.showDetails = value
			try {
				await savePushPreferences(value)
			} catch (error) {
				logger.error('could not save the notification preference', error)
				this.store.showDetails = before
				this.pushHint = this.t('mail_mobile', 'Could not save the setting.')
			}
		},

		async testPush() {
			try {
				const delivered = await sendTestPush()
				this.pushHint = delivered > 0
					? this.t('mail_mobile', 'Test notification sent — it may take a few seconds to arrive.')
					: this.t('mail_mobile', 'The push service did not accept the test notification. Try turning notifications off and on again.')
			} catch (error) {
				logger.error('could not send test notification', error)
			}
		},

		async install() {
			const prompt = this.store.installPrompt
			if (prompt) {
				// Native install prompt (Android/Chrome)
				this.store.installPrompt = null
				prompt.prompt()
				await prompt.userChoice
				return
			}
			this.showInstallHelp = !this.showInstallHelp
		},

		sorted(mailboxes) {
			return [...(mailboxes ?? [])].sort((a, b) => {
				const rankA = ROLE_ORDER[a.specialRole] ?? 9
				const rankB = ROLE_ORDER[b.specialRole] ?? 9
				return rankA - rankB || a.displayName.localeCompare(b.displayName)
			})
		},

		iconFor(mailbox) {
			return ROLE_ICONS[mailbox.specialRole] ?? '📁'
		},
	},
}
</script>

<style scoped>
.picker {
	padding: 8px 0 40px;
}
.picker__account {
	margin-bottom: 12px;
}
.picker__email {
	margin: 0;
	padding: 14px 16px 6px;
	font-size: 13px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.03em;
	color: var(--mob-text-muted);
}
.picker__error {
	margin: 0;
	padding: 4px 16px;
	color: var(--mob-danger);
	font-size: 13px;
}
.picker__box {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	padding: 12px 16px;
	border: none;
	background: transparent;
	color: var(--mob-text);
	font-size: 15px;
	text-align: start;
	cursor: pointer;
}
.picker__box:active {
	background-color: var(--mob-hover);
}
.picker__box-name {
	flex: 1;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.picker__badge {
	background-color: var(--mob-accent);
	color: var(--mob-accent-text);
	border-radius: 10px;
	padding: 1px 8px;
	font-size: 12px;
}
.picker__full {
	display: block;
	padding: 16px;
	text-align: center;
	color: var(--mob-accent);
	text-decoration: none;
	font-size: 14px;
}
.picker__install {
	padding: 8px 16px 0;
	text-align: center;
}
.picker__install-btn {
	width: 100%;
	padding: 12px;
	border: 1px solid var(--mob-accent);
	border-radius: var(--mob-radius);
	background: var(--mob-accent-soft);
	color: var(--mob-accent);
	font-size: 14px;
	font-weight: 600;
	cursor: pointer;
}
.picker__version {
	margin: 0;
	padding: 0 16px 8px;
	text-align: center;
	color: var(--mob-text-muted);
	font-size: 12px;
}
.picker__push-btn {
	margin-top: 8px;
}
.picker__details {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 10px;
	font-size: 14px;
	text-align: start;
}
.picker__source {
	display: block;
	padding: 0 16px 12px;
	text-align: center;
	color: var(--mob-text-muted);
	font-size: 12px;
}
.picker__install-help {
	margin: 10px 0 0;
	padding: 10px;
	border-radius: var(--mob-radius);
	background-color: var(--mob-hover);
	color: var(--mob-text-muted);
	font-size: 13px;
	text-align: start;
}
</style>
