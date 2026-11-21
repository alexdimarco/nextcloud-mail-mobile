/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Mail this page already loaded during this visit, kept in memory only:
// never written to the phone's storage, and gone when the page reloads or
// closes (signing in again always reloads it). Going back to a folder, or
// opening a message again, shows this copy at once while the newest one
// loads; with no connection, it is what stays on screen.

const MAX_LISTS = 10
const MAX_MESSAGES = 20

const lists = new Map()
const messages = new Map()

/**
 * Keep a value as the most recent, dropping the oldest beyond the limit.
 *
 * @param {Map} map lists or messages
 * @param {string|number} key what the value is kept under
 * @param {object} value the value
 * @param {number} max how many to keep
 */
function keep(map, key, value, max) {
	map.delete(key)
	map.set(key, value)
	while (map.size > max) {
		map.delete(map.keys().next().value)
	}
}

/**
 * @param {number} mailboxId the folder
 * @param {boolean} threaded whether the list groups conversations
 * @return {string} the key for that folder's list in that view
 */
function listKey(mailboxId, threaded) {
	return `${mailboxId}:${threaded ? 'conversations' : 'messages'}`
}

/**
 * Remember (part of) a folder's list: its messages, whether all were
 * loaded, and how far down it was scrolled.
 *
 * @param {number} mailboxId the folder
 * @param {boolean} threaded whether the list groups conversations
 * @param {object} fields any of envelopes, exhausted, scrollTop
 */
export function rememberList(mailboxId, threaded, fields) {
	const key = listKey(mailboxId, threaded)
	keep(lists, key, { envelopes: [], exhausted: false, scrollTop: 0, ...lists.get(key), ...fields }, MAX_LISTS)
}

/**
 * @param {number} mailboxId the folder
 * @param {boolean} threaded whether the list groups conversations
 * @return {object|null} { envelopes, exhausted, scrollTop }, or null
 */
export function recallList(mailboxId, threaded) {
	return lists.get(listKey(mailboxId, threaded)) ?? null
}

/**
 * @param {number} id the message's database id
 * @param {object} message the message as Mail sent it
 */
export function rememberMessage(id, message) {
	keep(messages, Number(id), message, MAX_MESSAGES)
}

/**
 * @param {number} id the message's database id
 * @return {object|null} the message, or null
 */
export function recallMessage(id) {
	return messages.get(Number(id)) ?? null
}

/**
 * Forget a deleted message, here and in every remembered list, so going
 * back does not show it again.
 *
 * @param {number} id the message's database id
 */
export function forgetMessage(id) {
	const key = Number(id)
	messages.delete(key)
	for (const list of lists.values()) {
		list.envelopes = list.envelopes.filter((envelope) => envelope.databaseId !== key)
	}
}

/**
 * Forget everything (for the tests).
 */
export function forgetEverything() {
	lists.clear()
	messages.clear()
}
