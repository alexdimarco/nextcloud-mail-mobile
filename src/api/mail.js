/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Every call this app makes to the official Mail app's web addresses
// (/apps/mail/api/...). These are the same addresses Mail's own desktop
// screens use. Mail does not promise them as a public interface, so they
// are kept together here: when Mail changes one, this is the file to fix.

import axios from '@nextcloud/axios'
import { generateOcsUrl, generateUrl } from '@nextcloud/router'
import logger from '../logger.js'
import { store } from '../store.js'

export const REAUTH_KEY = 'mail_mobile-reauth'
// When this page last reloaded itself to sign in again. Not cleared when
// a call succeeds: one call working while another keeps failing would
// otherwise still reload forever. Only the "Sign in again" button clears it.
export const REAUTH_ATTEMPT_KEY = 'mail_mobile-reauth-attempt'
export const REAUTH_BRAKE_MS = 2 * 60 * 1000

// Page reload, kept replaceable for the tests (jsdom cannot reload)
export const page = {
	reload: () => window.location.reload(),
}

// Time limits, so a slow or dead connection never leaves the page waiting
// for good. Reads and small changes: 20 seconds. Asking Mail to check the
// mail server for new mail runs in the background and can take long on a
// big folder: 2 minutes. Sending also waits for the mail server: 2
// minutes. Uploading a large file on a slow connection: 10 minutes.
export const TIME_LIMIT_MS = 20_000
export const SYNC_TIME_LIMIT_MS = 120_000
export const SEND_TIME_LIMIT_MS = 120_000
export const UPLOAD_TIME_LIMIT_MS = 600_000
const SUGGEST_TIME_LIMIT_MS = 10_000

/**
 * Whether the server never answered: no connection, or no answer within
 * the time limit. False when it answered, even with an error.
 *
 * @param {object} error the axios error
 * @return {boolean} whether no answer came
 */
export function isNoAnswer(error) {
	if (!error || error.response) {
		return false
	}
	return ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'].includes(error.code)
		|| error.message === 'Network Error'
}

/**
 * Every call to Mail goes through here: with a time limit, and noting in
 * the store that the connection works when an answer arrives.
 *
 * @param {function(object): Promise<object>} request makes the call, given the default options
 * @return {Promise<object>} axios's response
 */
async function call(request) {
	const resp = await request({ timeout: TIME_LIMIT_MS })
	store.offline = false
	return resp
}

const http = {
	get: (url, options = {}) => call((defaults) => axios.get(url, { ...defaults, ...options })),
	post: (url, data, options = {}) => call((defaults) => axios.post(url, data, { ...defaults, ...options })),
	put: (url, data, options = {}) => call((defaults) => axios.put(url, data, { ...defaults, ...options })),
	delete: (url, options = {}) => call((defaults) => axios.delete(url, { ...defaults, ...options })),
}

/**
 * @param {string} key the storage key
 * @return {string|null} the stored value, null if unavailable
 */
function readStorage(key) {
	try {
		return window.localStorage.getItem(key)
	} catch {
		return null
	}
}

/**
 * @param {string} key the storage key
 * @param {string|null} value the value, or null to remove it
 */
function writeStorage(key, value) {
	try {
		if (value === null) {
			window.localStorage.removeItem(key)
		} else {
			window.localStorage.setItem(key, value)
		}
	} catch {
		// localStorage unavailable: best effort only
	}
}

/**
 * Trigger a new sign-in. Single sign-on (for example OpenID Connect)
 * often loses the page address on the round trip and lands on the full
 * Mail app instead of here. Leave a short-lived marker so the small script
 * this app adds to Mail's page can send the person back.
 *
 * If the page already reloaded for this less than two minutes ago, it does
 * not reload again: a proxy error page or a sign-in loop would otherwise
 * reload the phone page forever. It shows a "Sign in again" button instead.
 *
 * @param {number} now the current time in milliseconds
 */
export function reauthenticate(now = Date.now()) {
	const last = Number(readStorage(REAUTH_ATTEMPT_KEY))
	if (last && now - last >= 0 && now - last < REAUTH_BRAKE_MS) {
		store.sessionExpired = true
		return
	}
	writeStorage(REAUTH_ATTEMPT_KEY, String(now))
	writeStorage(REAUTH_KEY, String(now))
	page.reload()
}

/**
 * The "Sign in again" button: the person asked for it, so no brake.
 */
export function signInAgain() {
	writeStorage(REAUTH_ATTEMPT_KEY, null)
	reauthenticate()
}

/**
 * Work out whether an error from Mail means "Mail cannot sign in to the
 * mail server" (or cannot reach it), and which.
 *
 * Official Mail answers such failures with a plain server error; some
 * builds answer with HTTP 424 and a reason. Both are handled.
 *
 * @param {object} error the axios error
 * @return {string|null} 'AUTHENTICATION_FAILED', 'RATE_LIMITED',
 *   'MAIL_SERVER_UNAVAILABLE' or null when it is some other error
 */
export function isMailLoginError(error) {
	const response = error?.response
	if (!response) {
		return null
	}
	if (response.status === 424) {
		return response.data?.data?.reason ?? 'AUTHENTICATION_FAILED'
	}
	const type = String(response.data?.data?.type ?? response.data?.type ?? '')
	if (/ServiceException|AuthenticationFailed|ImapAuthentication|LoginFailed/i.test(type)) {
		return 'AUTHENTICATION_FAILED'
	}
	if (response.status === 503) {
		return 'MAIL_SERVER_UNAVAILABLE'
	}
	return null
}

/**
 * Common error handling for calls to Mail:
 * - a 401, or an HTML page instead of JSON, means the session ran out:
 *   reload to sign in again
 * - a mail-server sign-in problem is put in the store, so the page shows
 *   a banner
 *
 * @param {object} error the axios error
 */
function handleError(error) {
	// The page says so, and keeps showing what it already loaded
	store.offline = isNoAnswer(error)
	const response = error.response
	if (response && response.status === 401) {
		reauthenticate()
		throw error
	}
	if (response && typeof response.data === 'string' && /<html/i.test(response.data)) {
		reauthenticate()
		throw error
	}
	const kind = isMailLoginError(error)
	if (kind) {
		store.authError = kind
	}
	throw error
}

/**
 * The person's mail accounts, each with its aliases.
 *
 * @return {Promise<Array>} accounts as Mail describes them
 */
export async function fetchAccounts() {
	let resp
	try {
		resp = await http.get(generateUrl('/apps/mail/api/accounts'))
	} catch (error) {
		handleError(error)
	}
	if (!Array.isArray(resp.data)) {
		// For example a proxy's or sign-in page's HTML instead of Mail's answer
		handleError({ response: resp })
	}
	return resp.data
}

/**
 * Add an address to send from (an alias) to one account, as the full Mail
 * app's account settings do. Mail stores it as given: it checks neither
 * the address nor whether the mail server lets the account send from it,
 * and it does not refuse an address the account already has.
 *
 * @param {number} accountId the account the address sends through
 * @param {string} alias the address
 * @param {string} aliasName the name shown with it
 * @return {Promise<object>} the new alias, shaped like the account's aliases
 */
export async function createAlias(accountId, alias, aliasName) {
	let resp
	try {
		resp = await http.post(generateUrl('/apps/mail/api/accounts/{accountId}/aliases', { accountId }), { alias, aliasName })
	} catch (error) {
		handleError(error)
	}
	if (typeof resp.data?.id !== 'number') {
		// For example a proxy's or sign-in page's HTML instead of Mail's answer
		handleError({ response: resp })
	}
	return resp.data
}

/**
 * The folders (mailboxes) of one account.
 *
 * @param {number} accountId the account id
 * @return {Promise<Array>} mailboxes
 */
export async function fetchMailboxes(accountId) {
	try {
		const resp = await http.get(generateUrl('/apps/mail/api/mailboxes'), { params: { accountId } })
		return resp.data?.mailboxes ?? []
	} catch (error) {
		handleError(error)
	}
}

/**
 * Pull new mail from the mail server into Mail's cache for one mailbox.
 *
 * fetchEnvelopes() only reads the cache; without this, the refresh button
 * would show the same list again. Mirrors the desktop app's sync call.
 *
 * @param {number} mailboxId the mailbox database id
 */
export async function syncMailbox(mailboxId) {
	const url = generateUrl('/apps/mail/api/mailboxes/{id}/sync', { id: mailboxId })
	const body = { ids: [], lastMessageTimestamp: null, init: false, sortOrder: 'newest', query: null }
	try {
		// 202 (sync accepted but not finished) still resolves; the caller
		// reads the partly updated cache anyway
		await http.post(url, body, { timeout: SYNC_TIME_LIMIT_MS })
	} catch (error) {
		// The mailbox has no cache yet (new account or cleared cache): a
		// full first sync is needed before quick syncs work. Mail answers
		// 428 (Precondition Required) for this; 412 is accepted too in case
		// a Mail version uses the neighbouring code.
		const status = error.response?.status
		if (status === 428 || status === 412) {
			try {
				await http.post(url, { ...body, init: true }, { timeout: SYNC_TIME_LIMIT_MS })
			} catch (initError) {
				handleError(initError)
			}
			return
		}
		handleError(error)
	}
}

export async function fetchEnvelopes(mailboxId, cursor, threaded = false) {
	const params = {
		mailboxId,
		limit: 25,
		view: threaded ? 'threaded' : 'singleton',
	}
	if (cursor) {
		params.cursor = cursor
	}
	try {
		const resp = await http.get(generateUrl('/apps/mail/api/messages'), { params })
		store.authError = null
		return resp.data
	} catch (error) {
		handleError(error)
	}
}

/**
 * Whether a row in the threaded list is likely a conversation of more
 * than one message. In threaded view Mail lists the newest message of
 * each conversation; when that message is not the conversation's first
 * one, there is more than one message. Tapping the row confirms it with
 * {@link fetchThread}.
 *
 * @param {object} envelope a message from fetchEnvelopes()
 * @return {boolean} whether to show the row as expandable
 */
export function looksLikeConversation(envelope) {
	if (!envelope || !envelope.threadRootId) {
		return false
	}
	if (envelope.messageId) {
		return envelope.threadRootId !== envelope.messageId
	}
	return !!envelope.inReplyTo
}

/**
 * Every message in the conversation the given message belongs to.
 *
 * @param {number} id a message database id
 * @return {Promise<Array>} the conversation's messages, or an empty array
 *   when the message has no conversation
 */
export async function fetchThread(id) {
	try {
		const resp = await http.get(generateUrl('/apps/mail/api/messages/{id}/thread', { id }))
		return resp.data ?? []
	} catch (error) {
		// A lone message has no thread (404): treat it as a single message
		if (error.response && error.response.status === 404) {
			return []
		}
		handleError(error)
	}
}

export async function fetchMessage(id) {
	try {
		const resp = await http.get(generateUrl('/apps/mail/api/messages/{id}/body', { id }))
		store.authError = null
		return resp.data
	} catch (error) {
		handleError(error)
	}
}

export function htmlBodyUrl(id) {
	return generateUrl('/apps/mail/api/messages/{id}/html?plain=true', { id })
}

export async function setFlags(id, flags) {
	try {
		await http.put(generateUrl('/apps/mail/api/messages/{id}/flags', { id }), { flags })
	} catch (error) {
		handleError(error)
	}
}

export async function deleteMessage(id) {
	try {
		await http.delete(generateUrl('/apps/mail/api/messages/{id}', { id }))
	} catch (error) {
		handleError(error)
	}
}

export async function moveMessage(id, destFolderId) {
	try {
		await http.post(generateUrl('/apps/mail/api/messages/{id}/move', { id }), { destFolderId })
	} catch (error) {
		handleError(error)
	}
}

/**
 * Address suggestions for the composer. Mail's general search covers
 * contacts (by name and by email address), addresses you mailed before,
 * and groups.
 *
 * @param {string} term what was typed
 * @return {Promise<Array>} suggestions with label and email
 */
export async function autocomplete(term) {
	const resp = await http.get(generateUrl('/apps/mail/api/autoComplete'), { params: { term }, timeout: SUGGEST_TIME_LIMIT_MS })
	return resp.data
}

export async function uploadAttachment(file, onProgress) {
	const data = new FormData()
	data.append('attachment', file)
	try {
		const resp = await http.post(generateUrl('/apps/mail/api/attachments'), data, {
			timeout: UPLOAD_TIME_LIMIT_MS,
			onUploadProgress: (prog) => onProgress && onProgress(prog.loaded, prog.total),
		})
		return resp.data
	} catch (error) {
		handleError(error)
	}
}

/**
 * Send through Mail's public send route. Used only when the outbox route
 * rejects the request because its expected fields changed. It cannot
 * carry attachments or mark the message as a reply.
 *
 * @param {object} payload the message, as for sendMessage()
 */
async function sendViaPublicRoute(payload) {
	await http.post(generateOcsUrl('/apps/mail/message/send'), {
		accountId: payload.accountId,
		fromEmail: payload.fromEmail,
		subject: payload.subject,
		body: payload.isHtml && payload.bodyHtml ? payload.bodyHtml : payload.body,
		isHtml: !!(payload.isHtml && payload.bodyHtml),
		to: payload.to,
		cc: payload.cc ?? [],
		bcc: payload.bcc ?? [],
	}, { headers: { 'OCS-APIRequest': 'true' }, timeout: SEND_TIME_LIMIT_MS })
}

export async function sendMessage(payload) {
	// Two steps, as in Mail's desktop app: put the message in the outbox,
	// then send it. Every field must be present; Mail has no defaults.
	const body = {
		accountId: payload.accountId,
		subject: payload.subject,
		bodyPlain: payload.body,
		bodyHtml: payload.bodyHtml ?? null,
		editorBody: payload.bodyHtml ?? payload.body,
		isHtml: payload.isHtml ?? false,
		smimeSign: false,
		smimeEncrypt: false,
		to: payload.to,
		cc: payload.cc ?? [],
		bcc: payload.bcc ?? [],
		attachments: payload.attachments ?? [],
		draftId: null,
		aliasId: payload.aliasId ?? null,
		inReplyToMessageId: payload.inReplyToMessageId ?? null,
		smimeCertificateId: null,
		sendAt: null,
		requestMdn: false,
		isPgpMime: false,
	}
	let created
	try {
		created = await http.post(generateUrl('/apps/mail/api/outbox'), body, { timeout: SEND_TIME_LIMIT_MS })
	} catch (error) {
		// Only when the outbox did not take the message at all: a fallback
		// after it was stored could send it twice
		const status = error.response?.status
		const canFallBack = (status === 400 || status === 422)
			&& payload.fromEmail
			&& (payload.attachments ?? []).length === 0
		if (!canFallBack) {
			handleError(error)
		}
		logger.warn('Mail outbox rejected the message, sending through the public route instead', { status })
		try {
			await sendViaPublicRoute(payload)
			return
		} catch (fallbackError) {
			handleError(fallbackError)
		}
	}
	try {
		const localId = created.data?.data?.id
		await http.post(generateUrl('/apps/mail/api/outbox/{id}', { id: localId }), undefined, { timeout: SEND_TIME_LIMIT_MS })
	} catch (error) {
		handleError(error)
	}
}
