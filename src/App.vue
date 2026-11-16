<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="mob" :class="{ 'mob--wide': isWide }">
		<header class="mob__bar">
			<button
				v-if="route.view !== 'list'"
				class="mob__icon-btn"
				:aria-label="t('mail_mobile', 'Back')"
				@click="back">
				‹
			</button>
			<button
				v-else
				class="mob__icon-btn"
				:aria-label="t('mail_mobile', 'Mailboxes')"
				@click="go('#/boxes')">
				☰
			</button>
			<h1 class="mob__title">
				{{ title }}
			</h1>
			<button
				v-if="isWide && store.accounts.length > 0"
				class="mob__icon-btn"
				:aria-label="t('mail_mobile', 'New message')"
				@click="openCompose">
				＋
			</button>
			<button
				v-if="route.view === 'list' || isWide"
				class="mob__icon-btn"
				:aria-label="t('mail_mobile', 'Refresh')"
				@click="refreshTick++">
				⟳
			</button>
		</header>

		<button
			v-if="stale"
			class="mob__update"
			@click="hardReload">
			{{ t('mail_mobile', 'An updated version is available — tap to reload') }}
		</button>

		<div v-if="store.sessionExpired" class="mob__banner" role="alert">
			{{ t('mail_mobile', 'Your Nextcloud session has ended, or the server answered with an error page.') }}
			<button class="mob__retry" @click="signInAgain">
				{{ t('mail_mobile', 'Sign in again') }}
			</button>
		</div>

		<div v-if="store.authError" class="mob__banner" role="alert">
			<template v-if="store.authError === 'RATE_LIMITED'">
				{{ t('mail_mobile', 'The mail server is temporarily not accepting sign-ins. Retrying automatically…') }}
			</template>
			<template v-else-if="store.authError === 'MAIL_SERVER_UNAVAILABLE'">
				{{ t('mail_mobile', 'The mail server cannot be reached right now. Try again in a few minutes.') }}
			</template>
			<template v-else>
				{{ t('mail_mobile', 'Authentication failed. Please update your credentials in the account settings of the full Mail app.') }}
			</template>
		</div>

		<div
			v-for="account in accountsToReconnect"
			:key="'reconnect-' + account.id"
			class="mob__banner"
			role="alert">
			<template v-if="account.isDelegated === true">
				{{ t('mail_mobile', 'The sign-in for {email} expired and could not be renewed. Someone shared this account with you, so only they can reconnect it, in their full Mail app.', { email: account.emailAddress }, AS_TEXT) }}
			</template>
			<template v-else>
				{{ t('mail_mobile', 'The sign-in for {email} expired and could not be renewed. Open the full Mail app and choose Reconnect.', { email: account.emailAddress }, AS_TEXT) }}
				<a class="mob__link" :href="fullAppUrl">{{ t('mail_mobile', 'Open the full Mail app') }}</a>
			</template>
		</div>

		<div class="mob__panes">
			<aside
				v-if="isWide || route.view === 'list' || route.view === 'boxes'"
				class="mob__aside">
				<MailboxPicker v-if="route.view === 'boxes'" @open="openMailbox" />
				<EnvelopeList
					v-else-if="mailbox"
					:key="mailbox.databaseId"
					:mailbox="mailbox"
					:refresh-tick="refreshTick"
					:selected-id="isWide ? store.currentEnvelope?.databaseId : null"
					@open="openMessage" />
				<div v-else-if="store.loading" class="mob__empty">
					{{ t('mail_mobile', 'Loading your mail…') }}
				</div>
				<div v-else-if="store.loadError" class="mob__empty">
					{{ t('mail_mobile', 'Could not load your mail accounts.') }}
					<button class="mob__retry" @click="retryLoad">
						{{ t('mail_mobile', 'Try again') }}
					</button>
				</div>
				<div v-else-if="store.accounts.length === 0" class="mob__empty">
					{{ t('mail_mobile', 'No mail account yet. Add one in the full Mail app first.') }}
					<a class="mob__link" :href="fullAppUrl">{{ t('mail_mobile', 'Open the full Mail app') }}</a>
				</div>
				<div v-else-if="store.accounts.some((account) => account.error)" class="mob__empty">
					{{ t('mail_mobile', 'Could not load your mail folders.') }}
					<button class="mob__retry" @click="retryLoad">
						{{ t('mail_mobile', 'Try again') }}
					</button>
				</div>
				<div v-else class="mob__empty">
					{{ t('mail_mobile', 'No mailbox found') }}
				</div>
			</aside>
			<main
				v-if="isWide || route.view === 'message' || route.view === 'compose'"
				class="mob__detail">
				<Reader
					v-if="route.view === 'message'"
					:key="route.params[1]"
					:message-id="Number(route.params[1])"
					@reply="openComposerWith"
					@forward="openComposerWith"
					@deleted="onDeleted" />
				<Composer v-else-if="route.view === 'compose'" @sent="back" />
				<div v-else class="mob__placeholder">
					{{ t('mail_mobile', 'Select a message to read') }}
				</div>
			</main>
		</div>

		<button
			v-if="route.view === 'list' && !isWide && store.accounts.length > 0"
			class="mob__fab"
			:aria-label="t('mail_mobile', 'New message')"
			@click="openCompose">
			+
		</button>
	</div>
</template>

<script>
import { generateUrl } from '@nextcloud/router'
import Composer from './views/Composer.vue'
import EnvelopeList from './views/EnvelopeList.vue'
import MailboxPicker from './views/MailboxPicker.vue'
import Reader from './views/Reader.vue'
import { signInAgain } from './api/mail.js'
import { AS_TEXT } from './l10nText.js'
import { defaultMailbox, findMailbox, loadAccounts, store } from './store.js'

export default {
	name: 'App',
	components: { EnvelopeList, MailboxPicker, Reader, Composer },
	data() {
		return {
			AS_TEXT,
			store,
			route: this.parseHash(),
			refreshTick: 0,
			fullAppUrl: generateUrl('/apps/mail/'),
			wideQuery: window.matchMedia('(min-width: 900px)'),
			isWide: window.matchMedia('(min-width: 900px)').matches,
		}
	},

	computed: {
		mailbox() {
			// In the message view params[0] is the mailbox id, so the wide
			// layout keeps showing the list next to the open message
			if ((this.route.view === 'list' || this.route.view === 'message') && this.route.params[0]) {
				return findMailbox(this.route.params[0]) ?? defaultMailbox()
			}
			return defaultMailbox()
		},

		stale() {
			return !!store.buildVersion && !!store.version && store.buildVersion !== store.version
		},

		// Mail 6 marks an account that signs in to the mail server with a
		// single sign-on token when that token expired and could not be
		// renewed. Only the full Mail app can reconnect it (its "Reconnect
		// your mail account" dialog), and only for the account's owner: an
		// account someone shared with you (Mail's delegation, isDelegated)
		// uses the owner's sign-in. Mail 5 never sends oauthNeedsReauth.
		accountsToReconnect() {
			return store.accounts.filter((account) => account.oauthNeedsReauth === true)
		},

		title() {
			switch (this.route.view) {
				case 'boxes': return this.t('mail_mobile', 'Mailboxes')
				case 'message': return this.store.currentEnvelope?.subject ?? this.t('mail_mobile', 'Message')
				case 'compose': return this.t('mail_mobile', 'New message')
				default: return this.mailbox ? `${this.mailbox.displayName} · ${this.mailbox.accountEmail}` : this.t('mail_mobile', 'Mail')
			}
		},
	},

	created() {
		window.addEventListener('hashchange', this.onHashChange)
		this.wideQuery.addEventListener('change', this.onWideChange)
	},

	beforeDestroy() {
		window.removeEventListener('hashchange', this.onHashChange)
		this.wideQuery.removeEventListener('change', this.onWideChange)
	},

	methods: {
		signInAgain,

		parseHash() {
			const parts = window.location.hash.replace(/^#\/?/, '').split('/')
			switch (parts[0]) {
				case 'boxes': return { view: 'boxes', params: [] }
				case 'box': return { view: 'list', params: [parts[1]] }
				case 'msg': return { view: 'message', params: [parts[1], parts[2]] }
				case 'compose': return { view: 'compose', params: [] }
				default: return { view: 'list', params: [] }
			}
		},

		onHashChange() {
			this.route = this.parseHash()
		},

		onWideChange(event) {
			this.isWide = event.matches
		},

		retryLoad() {
			loadAccounts()
		},

		go(hash) {
			window.location.hash = hash
		},

		hardReload() {
			// Cache-bust the reload so the browser fetches the fresh bundle
			const url = new URL(window.location.href)
			url.searchParams.set('_r', String(new Date().getTime()))
			window.location.replace(url.toString())
		},

		back() {
			window.history.back()
		},

		openMailbox(mailbox) {
			this.go(`#/box/${mailbox.databaseId}`)
		},

		openMessage(envelope) {
			this.store.currentEnvelope = envelope
			this.go(`#/msg/${envelope.mailboxId}/${envelope.databaseId}`)
		},

		openCompose() {
			this.store.composerPrefill = {
				accountId: this.mailbox ? this.mailbox.accountId : this.store.accounts[0]?.id,
			}
			this.go('#/compose')
		},

		openComposerWith(prefill) {
			this.store.composerPrefill = prefill
			this.go('#/compose')
		},

		onDeleted() {
			// Refresh the list so the deleted/changed message disappears, and
			// clear the reader (in wide mode) or go back to the list (narrow)
			this.refreshTick++
			this.store.currentEnvelope = null
			if (this.isWide && this.mailbox) {
				this.go(`#/box/${this.mailbox.databaseId}`)
			} else {
				this.back()
			}
		},
	},
}
</script>

<style>
/* Self-contained palette: this page deliberately does not use the
   Nextcloud CSS variables, so no server stylesheet (theming, guest.css)
   can change how it looks. Light and dark follow the device setting. */
:root {
	color-scheme: light dark;
	--mob-bg: #ffffff;
	--mob-bar-bg: rgba(255, 255, 255, 0.88);
	--mob-text: #1b2430;
	--mob-text-muted: #67707c;
	--mob-border: #e4e7ec;
	--mob-hover: #f2f4f7;
	--mob-accent: #2f6fed;
	--mob-accent-text: #ffffff;
	--mob-accent-soft: #e8effd;
	--mob-star: #f5b400;
	--mob-danger: #d92d20;
	--mob-danger-soft: #fbeae8;
	--mob-archive: #1a7f37;
	--mob-archive-soft: #e6f4ea;
	/* Faint tint marking an unread row, like Gmail's emphasis */
	--mob-unread-bg: #eef4ff;
	--mob-banner-bg: #b45309;
	--mob-radius: 10px;
}
@media (prefers-color-scheme: dark) {
	:root {
		--mob-bg: #12161c;
		--mob-bar-bg: rgba(18, 22, 28, 0.88);
		--mob-text: #e7eaee;
		--mob-text-muted: #98a2b0;
		--mob-border: #2a313b;
		--mob-hover: #1c222b;
		--mob-accent: #4c8dff;
		--mob-accent-text: #ffffff;
		--mob-accent-soft: #1b2a45;
		--mob-danger: #f97066;
		--mob-danger-soft: #2b1a1a;
		--mob-archive: #2fa84f;
		--mob-archive-soft: #17271c;
		--mob-unread-bg: #172234;
		--mob-banner-bg: #92400e;
	}
}

/* The base layout loads guest.css (login styling): kill the gradient
   background, login text color and the centered content box */
html, body,
body#body-public.layout-base {
	/* guest.css flex-centers the whole document (login layout), which
	   breaks scrolling for content taller than the viewport */
	display: block !important;
	justify-content: initial !important;
	align-items: initial !important;
	text-align: start !important;
	margin: 0;
	padding: 0;
	min-height: 100% !important;
	height: auto !important;
	overflow: visible !important;
	background: var(--mob-bg) !important;
	background-image: none !important;
	color: var(--mob-text) !important;
	overscroll-behavior-y: contain;
}
#content,
#content-vue,
body#body-public.layout-base #content.app-public {
	display: block !important;
	position: static !important;
	margin: 0 !important;
	padding: 0 !important;
	width: 100% !important;
	max-width: none !important;
	height: auto !important;
	min-height: 100vh;
	overflow: visible !important;
	background: transparent !important;
	border-radius: 0 !important;
	box-shadow: none !important;
}
* {
	box-sizing: border-box;
	-webkit-tap-highlight-color: transparent;
}
</style>

<style scoped>
.mob {
	max-width: 720px;
	margin: 0 auto;
	height: 100vh;
	height: 100dvh;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.mob__bar {
	position: sticky;
	top: 0;
	z-index: 10;
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 8px;
	padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
	background-color: var(--mob-bar-bg);
	backdrop-filter: blur(8px);
	border-bottom: 1px solid var(--mob-border);
}
.mob__title {
	flex: 1;
	margin: 0;
	font-size: 17px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.mob__icon-btn {
	flex: none;
	width: 44px;
	height: 44px;
	border: none;
	border-radius: var(--mob-radius);
	background: transparent;
	color: var(--mob-text);
	font-size: 24px;
	line-height: 1;
	cursor: pointer;
}
.mob__icon-btn:active {
	background-color: var(--mob-hover);
}
.mob__update {
	display: block;
	width: 100%;
	padding: 10px 12px;
	border: none;
	background-color: var(--mob-accent);
	color: var(--mob-accent-text);
	font-size: 14px;
	font-weight: 600;
	cursor: pointer;
}
.mob__banner {
	padding: 12px;
	background-color: var(--mob-banner-bg);
	color: #fff;
	font-size: 14px;
}
.mob__panes {
	/* The app owns scrolling: one internal scroller in single-column
	   mode, one per pane in the wide layout. The document never
	   scrolls, which keeps behavior identical across browsers. */
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	-webkit-overflow-scrolling: touch;
}
.mob--wide {
	max-width: none;
}
.mob--wide .mob__panes {
	display: grid;
	grid-template-columns: minmax(320px, 420px) 1fr;
	/* Constrain the single row to the container so the panes scroll
	   internally instead of growing past the viewport */
	grid-template-rows: minmax(0, 1fr);
	overflow: hidden;
}
.mob--wide .mob__aside {
	border-inline-end: 1px solid var(--mob-border);
	overflow-y: auto;
	min-height: 0;
}
.mob--wide .mob__detail {
	overflow-y: auto;
	min-height: 0;
}
.mob__placeholder {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 50vh;
	color: var(--mob-text-muted);
}
.mob__empty {
	padding: 40px 16px;
	text-align: center;
	color: var(--mob-text-muted);
}
.mob__retry,
.mob__link {
	display: block;
	margin: 16px auto 0;
	padding: 10px 16px;
	border: 1px solid var(--mob-accent);
	border-radius: var(--mob-radius);
	background: var(--mob-accent-soft);
	color: var(--mob-accent);
	font-size: 14px;
	text-decoration: none;
	cursor: pointer;
}
.mob__fab {
	position: fixed;
	right: calc(env(safe-area-inset-right, 0px) + 20px);
	bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
	width: 56px;
	height: 56px;
	border: none;
	border-radius: 50%;
	background-color: var(--mob-accent);
	color: var(--mob-accent-text);
	font-size: 30px;
	line-height: 1;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
	cursor: pointer;
}
</style>
