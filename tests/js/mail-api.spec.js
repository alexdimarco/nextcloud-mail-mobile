/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	autocomplete,
	createAlias,
	createPinnedTag,
	fetchEnvelopes,
	fetchMailboxes,
	isMailLoginError,
	isNoAnswer,
	isPinned,
	looksLikeConversation,
	page,
	pinnedFilter,
	REAUTH_ATTEMPT_KEY,
	reauthenticate,
	searchFilter,
	SEND_TIME_LIMIT_MS,
	sendMessage,
	setJunk,
	setPinned,
	SYNC_TIME_LIMIT_MS,
	syncMailbox,
	TIME_LIMIT_MS,
	UPLOAD_TIME_LIMIT_MS,
	uploadAttachment,
} from '../../src/api/mail.js'

const axiosMock = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
}))
vi.mock('@nextcloud/axios', () => ({ default: axiosMock }))

const storeMock = vi.hoisted(() => ({ authError: null, offline: false }))
vi.mock('../../src/store.js', () => ({ store: storeMock }))

function httpError(status, data = {}) {
	const error = new Error('Request failed with status ' + status)
	error.response = { status, data }
	return error
}

const MESSAGE = {
	accountId: 1,
	fromEmail: 'me@example.com',
	subject: 'Hello',
	body: 'Hi there',
	bodyHtml: null,
	isHtml: false,
	to: [{ label: 'sam@example.com', email: 'sam@example.com' }],
	cc: [],
	bcc: [],
	attachments: [],
}

describe('Mail error handling', () => {
	it('reads the typed 424 sign-in error', () => {
		expect(isMailLoginError(httpError(424, { data: { reason: 'RATE_LIMITED' } }))).toBe('RATE_LIMITED')
		expect(isMailLoginError(httpError(424))).toBe('AUTHENTICATION_FAILED')
	})

	it('treats Mail\'s ordinary service errors as a sign-in problem', () => {
		expect(isMailLoginError(httpError(500, { data: { type: 'OCA\\Mail\\Exception\\ServiceException' } }))).toBe('AUTHENTICATION_FAILED')
		expect(isMailLoginError(httpError(400, { type: 'OCA\\Mail\\Exception\\ServiceException' }))).toBe('AUTHENTICATION_FAILED')
	})

	it('reports a temporarily unreachable mail server separately', () => {
		expect(isMailLoginError(httpError(503, { status: 'error', message: 'Server error' }))).toBe('MAIL_SERVER_UNAVAILABLE')
	})

	it('ignores other errors', () => {
		expect(isMailLoginError(httpError(404))).toBe(null)
		expect(isMailLoginError(httpError(500, { status: 'error', message: 'Server error' }))).toBe(null)
		expect(isMailLoginError(new Error('offline'))).toBe(null)
	})
})

describe('telling "no answer" from an error answer', () => {
	it('counts no connection and a time limit running out', () => {
		expect(isNoAnswer({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(true)
		expect(isNoAnswer({ code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' })).toBe(true)
		expect(isNoAnswer({ code: 'ETIMEDOUT' })).toBe(true)
	})

	it('does not count an answer, even an error one, or a cancelled call', () => {
		expect(isNoAnswer(httpError(500))).toBe(false)
		expect(isNoAnswer(httpError(404))).toBe(false)
		expect(isNoAnswer({ code: 'ERR_CANCELED', message: 'canceled' })).toBe(false)
		expect(isNoAnswer(null)).toBe(false)
	})
})

describe('search text for Mail', () => {
	it('looks for the words in the sender, the recipients and the subject, as Mail\'s own search box does', () => {
		expect(searchFilter('invoice')).toBe('to:invoice from:invoice subject:invoice match:anyof')
	})

	it('keeps spaces, colons and plus signs inside the value', () => {
		// Mail splits its search text at spaces and each part at its colon,
		// and reads a plus sign as a space
		expect(searchFilter('  Re: a+b ')).toBe('to:Re%3A%20a%2Bb from:Re%3A%20a%2Bb subject:Re%3A%20a%2Bb match:anyof')
	})

	it('also looks in the message text, word by word, when the account says so', () => {
		expect(searchFilter('lunch friday', { body: true }))
			.toBe('to:lunch%20friday from:lunch%20friday subject:lunch%20friday body:lunch body:friday match:anyof')
	})

	it('is empty when there is nothing to look for', () => {
		expect(searchFilter('')).toBe('')
		expect(searchFilter('   ')).toBe('')
		expect(searchFilter(null)).toBe('')
	})
})

describe('conversation hint', () => {
	it('marks a reply as part of a conversation', () => {
		expect(looksLikeConversation({ messageId: '<b@x>', threadRootId: '<a@x>' })).toBe(true)
	})

	it('does not mark a lone message', () => {
		expect(looksLikeConversation({ messageId: '<a@x>', threadRootId: '<a@x>' })).toBe(false)
		expect(looksLikeConversation({ messageId: '<a@x>' })).toBe(false)
		expect(looksLikeConversation(null)).toBe(false)
	})
})

describe('junk and pin', () => {
	beforeEach(() => {
		Object.values(axiosMock).forEach((mock) => mock.mockReset())
	})

	it('marks junk as Mail\'s own "Mark as spam" does, in Mail\'s order', async () => {
		axiosMock.put.mockResolvedValue({ data: {} })

		await setJunk(5, true)
		await setJunk(6, false)

		expect(axiosMock.put.mock.calls[0]).toEqual(['/index.php/apps/mail/api/messages/5/flags', { flags: { $junk: true, $notjunk: false } }, { timeout: TIME_LIMIT_MS }])
		expect(Object.keys(axiosMock.put.mock.calls[0][1].flags)).toEqual(['$junk', '$notjunk'])
		expect(axiosMock.put.mock.calls[1][1]).toEqual({ flags: { $junk: false, $notjunk: true } })
	})

	it('asks Mail for its "Pinned" tag, by a name that is never translated', async () => {
		axiosMock.post.mockResolvedValueOnce({ data: { id: 9, imapLabel: '$pinned', displayName: 'Pinned' } })

		await expect(createPinnedTag()).resolves.toEqual({ id: 9, imapLabel: '$pinned', displayName: 'Pinned' })
		expect(axiosMock.post).toHaveBeenCalledWith('/index.php/apps/mail/api/tags', { displayName: 'Pinned', color: '#2f6fed' }, { timeout: TIME_LIMIT_MS })
	})

	it('pins and unpins with the tag\'s mark', async () => {
		axiosMock.put.mockResolvedValue({ data: {} })
		axiosMock.delete.mockResolvedValue({ data: {} })

		await setPinned(5, true)
		await setPinned(5, false)

		expect(axiosMock.put).toHaveBeenCalledWith('/index.php/apps/mail/api/messages/5/tags/%24pinned', undefined, { timeout: TIME_LIMIT_MS })
		expect(axiosMock.delete).toHaveBeenCalledWith('/index.php/apps/mail/api/messages/5/tags/%24pinned', { timeout: TIME_LIMIT_MS })
	})

	it('says when pinning did not work', async () => {
		axiosMock.put.mockRejectedValueOnce(httpError(403))
		await expect(setPinned(5, true)).rejects.toThrow()
	})

	it('finds the pinned messages by the tag\'s id', () => {
		expect(pinnedFilter(9)).toBe('tags:9')
		expect(pinnedFilter('9 from:x')).toBe('tags:NaN')
	})

	it('reads the pin from the tags Mail lists with a message', () => {
		expect(isPinned({ tags: { $pinned: { id: 9 } } })).toBe(true)
		expect(isPinned({ tags: { $label1: { id: 1 } } })).toBe(false)
		// Mail sends [] for a message with no tags
		expect(isPinned({ tags: [] })).toBe(false)
		expect(isPinned({})).toBe(false)
		expect(isPinned(null)).toBe(false)
	})
})

describe('calls to Mail', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Also drop queued one-off answers, so one failing test cannot
		// leave answers behind for the next
		Object.values(axiosMock).forEach((mock) => mock.mockReset())
		storeMock.authError = null
	})

	it('loads mailboxes from Mail\'s mailbox list', async () => {
		axiosMock.get.mockResolvedValueOnce({ data: { id: 1, mailboxes: [{ databaseId: 2 }] } })
		await expect(fetchMailboxes(1)).resolves.toEqual([{ databaseId: 2 }])
		expect(axiosMock.get).toHaveBeenCalledWith('/index.php/apps/mail/api/mailboxes', { params: { accountId: 1 }, timeout: TIME_LIMIT_MS })
	})

	it('runs a full first sync when Mail says the mailbox is not cached yet (428)', async () => {
		// Mail 5.13 answers 428 for a mailbox it has never synced (a new account)
		axiosMock.post.mockRejectedValueOnce(httpError(428)).mockResolvedValueOnce({ data: {} })
		await expect(syncMailbox(7)).resolves.toBeUndefined()
		expect(axiosMock.post).toHaveBeenCalledTimes(2)
		expect(axiosMock.post.mock.calls[0][1].init).toBe(false)
		expect(axiosMock.post.mock.calls[1]).toEqual(['/index.php/apps/mail/api/mailboxes/7/sync', expect.objectContaining({ init: true }), { timeout: SYNC_TIME_LIMIT_MS }])
	})

	it('reports a failed first sync like any other error', async () => {
		axiosMock.post.mockRejectedValueOnce(httpError(428)).mockRejectedValueOnce(httpError(424, { data: { reason: 'AUTHENTICATION_FAILED' } }))
		await expect(syncMailbox(7)).rejects.toThrow()
		expect(storeMock.authError).toBe('AUTHENTICATION_FAILED')
	})

	it('uses Mail\'s general address search for suggestions', async () => {
		axiosMock.get.mockResolvedValueOnce({ data: [{ label: 'Sam', email: 'sam@example.com' }] })
		await autocomplete('sa')
		expect(axiosMock.get).toHaveBeenCalledWith('/index.php/apps/mail/api/autoComplete', { params: { term: 'sa' }, timeout: 10_000 })
	})

	it('reads a folder\'s messages, and only the matching ones when searching', async () => {
		axiosMock.get.mockResolvedValue({ data: [] })

		await fetchEnvelopes(2, undefined, false)
		await fetchEnvelopes(2, 1700000000, true, 'subject:x match:anyof')

		expect(axiosMock.get.mock.calls[0]).toEqual(['/index.php/apps/mail/api/messages', {
			params: { mailboxId: 2, limit: 25, view: 'singleton' },
			timeout: TIME_LIMIT_MS,
		}])
		expect(axiosMock.get.mock.calls[1][1].params).toEqual({
			mailboxId: 2,
			limit: 25,
			view: 'threaded',
			cursor: 1700000000,
			filter: 'subject:x match:anyof',
		})
	})

	it('adds an address to send from to the account, as Mail\'s settings do', async () => {
		const alias = { id: 12, name: 'Jane', alias: 'hello@second.example', signature: null }
		axiosMock.post.mockResolvedValueOnce({ status: 201, data: alias })

		await expect(createAlias(1, 'hello@second.example', 'Jane')).resolves.toEqual(alias)
		expect(axiosMock.post).toHaveBeenCalledWith('/index.php/apps/mail/api/accounts/1/aliases', {
			alias: 'hello@second.example',
			aliasName: 'Jane',
		}, { timeout: TIME_LIMIT_MS })
	})

	it('does not take an answer without the new address\'s number', async () => {
		axiosMock.post.mockResolvedValueOnce({ status: 200, data: { status: 'ok' } })

		await expect(createAlias(1, 'hello@second.example', 'Jane')).rejects.toBeTruthy()
	})

	it('notes in the store when Mail does not answer, and clears it on the next answer', async () => {
		axiosMock.get.mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' })
		await expect(fetchMailboxes(1)).rejects.toBeTruthy()
		expect(storeMock.offline).toBe(true)

		axiosMock.get.mockResolvedValueOnce({ data: { mailboxes: [] } })
		await fetchMailboxes(1)
		expect(storeMock.offline).toBe(false)
	})

	it('an error answer means the connection works', async () => {
		storeMock.offline = true
		axiosMock.get.mockRejectedValueOnce(httpError(500, { status: 'error', message: 'Server error' }))
		await expect(fetchMailboxes(1)).rejects.toBeTruthy()
		expect(storeMock.offline).toBe(false)
	})

	it('gives checking for new mail and uploads more time', async () => {
		axiosMock.post.mockResolvedValueOnce({ data: {} })
		await syncMailbox(7)
		expect(axiosMock.post.mock.calls[0][2]).toEqual({ timeout: SYNC_TIME_LIMIT_MS })

		axiosMock.post.mockResolvedValueOnce({ data: { id: 3 } })
		await uploadAttachment(new Blob(['x']))
		expect(axiosMock.post.mock.calls[1][2]).toEqual(expect.objectContaining({ timeout: UPLOAD_TIME_LIMIT_MS }))
	})

	it('flags a sign-in problem in the store', async () => {
		axiosMock.get.mockRejectedValueOnce(httpError(424, { data: { reason: 'AUTHENTICATION_FAILED' } }))
		await expect(fetchMailboxes(1)).rejects.toThrow()
		expect(storeMock.authError).toBe('AUTHENTICATION_FAILED')
	})
})

describe('sending', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('puts the message in the outbox, then sends it', async () => {
		axiosMock.post
			.mockResolvedValueOnce({ data: { data: { id: 42 } } })
			.mockResolvedValueOnce({ data: {} })
		await sendMessage(MESSAGE)
		expect(axiosMock.post).toHaveBeenNthCalledWith(1, '/index.php/apps/mail/api/outbox', expect.objectContaining({
			accountId: 1,
			subject: 'Hello',
			bodyPlain: 'Hi there',
		}), { timeout: SEND_TIME_LIMIT_MS })
		expect(axiosMock.post).toHaveBeenNthCalledWith(2, '/index.php/apps/mail/api/outbox/42', undefined, { timeout: SEND_TIME_LIMIT_MS })
	})

	it('gives the outbox the alias to send from', async () => {
		axiosMock.post
			.mockResolvedValueOnce({ data: { data: { id: 42 } } })
			.mockResolvedValueOnce({ data: {} })
		await sendMessage({ ...MESSAGE, aliasId: 7, fromEmail: 'support@example.com' })
		expect(axiosMock.post).toHaveBeenNthCalledWith(1, '/index.php/apps/mail/api/outbox', expect.objectContaining({
			accountId: 1,
			aliasId: 7,
		}), expect.anything())
	})

	it('sends from the account itself when no alias is given', async () => {
		axiosMock.post
			.mockResolvedValueOnce({ data: { data: { id: 42 } } })
			.mockResolvedValueOnce({ data: {} })
		await sendMessage(MESSAGE)
		expect(axiosMock.post.mock.calls[0][1].aliasId).toBe(null)
	})

	it('falls back to Mail\'s public send route when the outbox rejects the fields', async () => {
		axiosMock.post
			.mockRejectedValueOnce(httpError(400))
			.mockResolvedValueOnce({ data: {} })
		await sendMessage(MESSAGE)
		expect(axiosMock.post).toHaveBeenCalledTimes(2)
		const [url, body, options] = axiosMock.post.mock.calls[1]
		expect(url).toMatch(/\/ocs\/v2\.php\/apps\/mail\/message\/send$/)
		expect(body).toEqual(expect.objectContaining({ accountId: 1, fromEmail: 'me@example.com', body: 'Hi there', isHtml: false }))
		expect(options.headers['OCS-APIRequest']).toBe('true')
	})

	it('does not fall back when there are attachments', async () => {
		axiosMock.post.mockRejectedValueOnce(httpError(400))
		await expect(sendMessage({ ...MESSAGE, attachments: [{ type: 'local', id: 3 }] })).rejects.toThrow()
		expect(axiosMock.post).toHaveBeenCalledTimes(1)
	})

	it('never falls back once the outbox has the message', async () => {
		axiosMock.post
			.mockResolvedValueOnce({ data: { data: { id: 42 } } })
			.mockRejectedValueOnce(httpError(400))
		await expect(sendMessage(MESSAGE)).rejects.toThrow()
		expect(axiosMock.post).toHaveBeenCalledTimes(2)
	})
})

describe('signing in again after the session ran out', () => {
	let reload

	beforeEach(() => {
		window.localStorage.clear()
		storeMock.sessionExpired = false
		reload = vi.fn()
		page.reload = reload
	})

	it('reloads once to sign in again', () => {
		reauthenticate(1_000_000)

		expect(reload).toHaveBeenCalledTimes(1)
		expect(window.localStorage.getItem(REAUTH_ATTEMPT_KEY)).toBe('1000000')
		expect(storeMock.sessionExpired).toBe(false)
	})

	it('shows a button instead of reloading again within two minutes', () => {
		reauthenticate(1_000_000)
		reauthenticate(1_000_000 + 60_000)

		expect(reload).toHaveBeenCalledTimes(1)
		expect(storeMock.sessionExpired).toBe(true)
	})

	it('reloads again once two minutes have passed', () => {
		reauthenticate(1_000_000)
		reauthenticate(1_000_000 + 3 * 60_000)

		expect(reload).toHaveBeenCalledTimes(2)
	})

	it('does not reload forever when a proxy answers with an HTML page', async () => {
		axiosMock.get.mockResolvedValue({ status: 200, data: '<!DOCTYPE html><HTML><body>Gateway error</body></HTML>' })
		const { fetchAccounts } = await import('../../src/api/mail.js')

		await expect(fetchAccounts()).rejects.toBeTruthy()
		await expect(fetchAccounts()).rejects.toBeTruthy()

		expect(reload).toHaveBeenCalledTimes(1)
		expect(storeMock.sessionExpired).toBe(true)
	})
})
