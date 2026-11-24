/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { loadState } from '@nextcloud/initial-state'
import Vue from 'vue'
import { fetchAccounts, fetchMailboxes } from './api/mail.js'
import logger from './logger.js'

/**
 * Read a saved yes/no preference, tolerating unavailable localStorage.
 *
 * @param {string} key the storage key
 * @return {boolean} the stored value, false if unset or unavailable
 */
function readFlag(key) {
	try {
		return window.localStorage.getItem(key) === '1'
	} catch {
		return false
	}
}

// Built into the bundle (webpack DefinePlugin). Compared with the version
// the server reports, it shows when a phone runs an old cached copy.

const buildVersion = typeof appVersion === 'string' ? appVersion : ''

export const store = Vue.observable({
	accounts: [],
	// true until the accounts and their mailboxes have been loaded
	loading: true,
	// set when the accounts could not be loaded at all
	loadError: false,
	version: loadState('mail_mobile', 'version', ''),
	mailVersion: loadState('mail_mobile', 'mail-version', ''),
	swUrl: loadState('mail_mobile', 'sw-url', ''),
	swScope: loadState('mail_mobile', 'sw-scope', ''),
	iconUrl: loadState('mail_mobile', 'icon-url', ''),
	// show sender and subject in notifications (off unless chosen)
	showDetails: loadState('mail_mobile', 'show-details', false),
	sourceUrl: loadState('mail_mobile', 'source-url', ''),
	// The id of the person's "Pinned" tag in Mail; null until something
	// is first pinned
	pinnedTagId: loadState('mail_mobile', 'pinned-tag', null),
	buildVersion,
	// Group the message list by conversation (threaded view). Saved.
	threaded: readFlag('mail_mobile-threaded'),
	// null | 'AUTHENTICATION_FAILED' | 'RATE_LIMITED' | 'MAIL_SERVER_UNAVAILABLE'
	authError: null,
	// signing in again did not help: show a "Sign in again" button
	sessionExpired: false,
	// the last call to Mail got no answer (no connection, or none within
	// its time limit); the next answer clears it
	offline: false,
	// reply details handed from Reader to Composer
	composerPrefill: null,
	// message handed from EnvelopeList to Reader
	currentEnvelope: null,
	// the captured install prompt (Chrome on Android)
	installPrompt: null,
	// already opened from a home-screen icon?
	isStandalone: window.matchMedia?.('(display-mode: standalone)')?.matches
		|| window.navigator.standalone === true,
})

/**
 * Load the accounts and their mailboxes from Mail. An account whose
 * mailboxes cannot be loaded is kept, marked with an error, so the page
 * can say which account has a problem.
 */
export async function loadAccounts() {
	store.loading = true
	store.loadError = false
	try {
		const accounts = await fetchAccounts() ?? []
		store.accounts = await Promise.all(accounts.map(async (account) => {
			try {
				const mailboxes = await fetchMailboxes(account.id) ?? []
				return { ...account, mailboxes }
			} catch (error) {
				logger.warn('could not load the mailboxes of an account', { error })
				return { ...account, mailboxes: [], error: true }
			}
		}))
	} catch (error) {
		logger.error('could not load mail accounts', { error })
		store.loadError = true
	} finally {
		store.loading = false
	}
}

export function setThreaded(value) {
	store.threaded = value
	try {
		window.localStorage.setItem('mail_mobile-threaded', value ? '1' : '0')
	} catch {
		// localStorage unavailable: the choice just won't be saved
	}
}

export function allMailboxes() {
	return store.accounts.flatMap((account) => (account.mailboxes ?? []).map((mailbox) => ({
		...mailbox,
		accountEmail: account.emailAddress,
	})))
}

export function findMailbox(databaseId) {
	return allMailboxes().find((mailbox) => mailbox.databaseId === Number(databaseId))
}

export function defaultMailbox() {
	const boxes = allMailboxes()
	return boxes.find((mailbox) => mailbox.specialRole === 'inbox') ?? boxes[0]
}

export function accountFor(mailbox) {
	return store.accounts.find((account) => account.id === mailbox.accountId)
}
