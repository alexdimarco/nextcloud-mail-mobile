/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanEditorHtml, DRAFT_KEY, DRAFT_MAX_AGE_MS, keepDraft, takeDraft } from '../../src/draft.js'

const user = vi.hoisted(() => ({ uid: 'jane' }))
vi.mock('@nextcloud/auth', () => ({
	getCurrentUser: () => (user.uid ? { uid: user.uid } : null),
}))

describe('a message kept across a reload of the page', () => {
	beforeEach(() => {
		window.sessionStorage.clear()
		user.uid = 'jane'
	})

	it('comes back once, and is deleted from storage when it does', () => {
		keepDraft({ to: 'a@b.example', body: 'Hello' }, 1000)

		expect(takeDraft(2000)).toMatchObject({ to: 'a@b.example', body: 'Hello', user: 'jane' })
		expect(window.sessionStorage.getItem(DRAFT_KEY)).toBe(null)
		expect(takeDraft(2000)).toBe(null)
	})

	it('is not brought back after an hour', () => {
		keepDraft({ body: 'Hello' }, 1000)

		expect(takeDraft(1000 + DRAFT_MAX_AGE_MS)).toBe(null)
		expect(window.sessionStorage.getItem(DRAFT_KEY)).toBe(null)
	})

	it('is never shown to someone else who signed in on the phone meanwhile', () => {
		keepDraft({ body: 'Private' }, 1000)
		user.uid = 'sam'

		expect(takeDraft(2000)).toBe(null)
		expect(window.sessionStorage.getItem(DRAFT_KEY)).toBe(null)
	})

	it('ignores something unreadable in storage', () => {
		window.sessionStorage.setItem(DRAFT_KEY, '{not json')

		expect(takeDraft(2000)).toBe(null)
	})
})

describe('cleaning the rich editor\'s text before it is put back', () => {
	it('keeps the editor\'s own formatting', () => {
		expect(cleanEditorHtml('<div><b>Bold</b> <i>it</i> <u>u</u><br></div><div>Next</div>'))
			.toBe('<div><b>Bold</b> <i>it</i> <u>u</u><br></div><div>Next</div>')
	})

	it('drops every attribute, script, image and link, keeping their text', () => {
		const html = '<div style="color:red" onclick="steal()">Hi <a href="https://evil.example">there</a>'
			+ '<img src="https://evil.example/track.png" onerror="steal()"><script>steal()</script></div>'

		expect(cleanEditorHtml(html)).toBe('<div>Hi there</div>')
	})

	it('returns nothing for nothing', () => {
		expect(cleanEditorHtml('')).toBe('')
		expect(cleanEditorHtml(null)).toBe('')
	})
})
