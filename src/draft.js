/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// A message being written, kept across a reload of the page. The page
// reloads itself when the Nextcloud session runs out (to sign in again)
// and when an updated version is out, and a person can reload it too.
// The message is put in the browser's session storage only as the page
// goes away, and taken out (and deleted there) as soon as the page is
// back: it does not stay on the phone, and closing the tab or app ends
// that storage.

import { getCurrentUser } from '@nextcloud/auth'

export const DRAFT_KEY = 'mail_mobile-unsent'
// Signing in again through single sign-on can take a while
export const DRAFT_MAX_AGE_MS = 60 * 60 * 1000

// Formatting the editor's Bold, Italic and Underline buttons and typing
// make. Anything else is kept as its text only.
const KEPT_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'SPAN', 'UL', 'OL', 'LI', 'BLOCKQUOTE'])
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH'])

/**
 * @return {string|null} the Nextcloud user signed in on this page
 */
function currentUid() {
	return getCurrentUser()?.uid ?? null
}

/**
 * Keep the message being written, as the page goes away.
 *
 * @param {object} fields what the composer needs to show it again
 * @param {number} now the current time in milliseconds
 */
export function keepDraft(fields, now = Date.now()) {
	try {
		window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...fields, user: currentUid(), savedAt: now }))
	} catch {
		// Storage unavailable or full: nothing is kept
	}
}

/**
 * Delete a kept message that is no longer needed: the page came back
 * from the browser's back-forward cache with the message still on screen,
 * or the message was sent or discarded. Otherwise a later reload could
 * bring back a message already sent.
 */
export function forgetDraft() {
	try {
		window.sessionStorage.removeItem(DRAFT_KEY)
	} catch {
		// Storage unavailable: nothing was kept
	}
}

/**
 * Take back the message kept as the page went away, deleting it from
 * storage. Only a recent one, written by the person now signed in.
 *
 * @param {number} now the current time in milliseconds
 * @return {object|null} the kept fields, or null
 */
export function takeDraft(now = Date.now()) {
	let raw
	try {
		raw = window.sessionStorage.getItem(DRAFT_KEY)
		window.sessionStorage.removeItem(DRAFT_KEY)
	} catch {
		return null
	}
	if (!raw) {
		return null
	}
	try {
		const draft = JSON.parse(raw)
		const age = now - Number(draft.savedAt)
		if (!(age >= 0 && age < DRAFT_MAX_AGE_MS)) {
			return null
		}
		// Someone else signed in on this phone in between: not theirs to see
		if (draft.user !== currentUid()) {
			return null
		}
		return draft
	} catch {
		return null
	}
}

/**
 * Copy the editor's formatting from one element to another, with no
 * attributes at all: nothing in it can load or run.
 *
 * @param {Node} from the parsed copy
 * @param {Element} to where it goes
 */
function copyFormatting(from, to) {
	for (const node of from.childNodes) {
		if (node.nodeType === 3) {
			to.appendChild(to.ownerDocument.createTextNode(node.textContent))
		} else if (node.nodeType === 1 && !DROPPED_TAGS.has(node.tagName.toUpperCase())) {
			if (KEPT_TAGS.has(node.tagName.toUpperCase())) {
				const element = to.ownerDocument.createElement(node.tagName.toLowerCase())
				copyFormatting(node, element)
				to.appendChild(element)
			} else {
				copyFormatting(node, to)
			}
		}
	}
}

/**
 * The rich editor's HTML, cleaned before it is put back in the editor:
 * only plain formatting, no attributes, no links, images or scripts.
 * DOMParser builds an inert document, so nothing loads while cleaning.
 *
 * @param {string} html the editor's HTML as kept
 * @return {string} the cleaned HTML
 */
export function cleanEditorHtml(html) {
	const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
	const out = doc.createElement('div')
	copyFormatting(doc.body, out)
	return out.innerHTML
}
