/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	autocomplete,
	fetchMailboxes,
	isMailLoginError,
	looksLikeConversation,
	page,
	REAUTH_ATTEMPT_KEY,
	reauthenticate,
	sendMessage,
	syncMailbox,
} from '../../src/api/mail.js'

const axiosMock = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
}))
vi.mock('@nextcloud/axios', () => ({ default: axiosMock }))

const storeMock = vi.hoisted(() => ({ authError: null }))
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
		expect(axiosMock.get).toHaveBeenCalledWith('/index.php/apps/mail/api/mailboxes', { params: { accountId: 1 } })
	})

	it('runs a full first sync when Mail says the mailbox is not cached yet (428)', async () => {
		// Mail 5.13 answers 428 for a mailbox it has never synced (a new account)
		axiosMock.post.mockRejectedValueOnce(httpError(428)).mockResolvedValueOnce({ data: {} })
		await expect(syncMailbox(7)).resolves.toBeUndefined()
		expect(axiosMock.post).toHaveBeenCalledTimes(2)
		expect(axiosMock.post.mock.calls[0][1].init).toBe(false)
		expect(axiosMock.post.mock.calls[1]).toEqual(['/index.php/apps/mail/api/mailboxes/7/sync', expect.objectContaining({ init: true })])
	})

	it('reports a failed first sync like any other error', async () => {
		axiosMock.post.mockRejectedValueOnce(httpError(428)).mockRejectedValueOnce(httpError(424, { data: { reason: 'AUTHENTICATION_FAILED' } }))
		await expect(syncMailbox(7)).rejects.toThrow()
		expect(storeMock.authError).toBe('AUTHENTICATION_FAILED')
	})

	it('uses Mail\'s general address search for suggestions', async () => {
		axiosMock.get.mockResolvedValueOnce({ data: [{ label: 'Sam', email: 'sam@example.com' }] })
		await autocomplete('sa')
		expect(axiosMock.get).toHaveBeenCalledWith('/index.php/apps/mail/api/autoComplete', { params: { term: 'sa' } })
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
		}))
		expect(axiosMock.post).toHaveBeenNthCalledWith(2, '/index.php/apps/mail/api/outbox/42')
	})

	it('gives the outbox the alias to send from', async () => {
		axiosMock.post
			.mockResolvedValueOnce({ data: { data: { id: 42 } } })
			.mockResolvedValueOnce({ data: {} })
		await sendMessage({ ...MESSAGE, aliasId: 7, fromEmail: 'support@example.com' })
		expect(axiosMock.post).toHaveBeenNthCalledWith(1, '/index.php/apps/mail/api/outbox', expect.objectContaining({
			accountId: 1,
			aliasId: 7,
		}))
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
