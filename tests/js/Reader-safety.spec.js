/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import Reader, { htmlToText, linkify } from '../../src/views/Reader.vue'
import { forgetEverything } from '../../src/memory.js'
import { l10nMocks } from './l10n.js'

vi.mock('../../src/api/mail.js', () => ({
	fetchMessage: vi.fn(),
	setFlags: vi.fn(),
	deleteMessage: vi.fn(),
	htmlBodyUrl: (id) => `/html/${id}`,
	createPinnedTag: vi.fn(),
	setPinned: vi.fn(),
	setJunk: vi.fn(),
	isPinned: (envelope) => !!envelope?.tags?.$pinned,
	PINNED_LABEL: '$pinned',
	PINNED_TAG_NAME: 'Pinned',
}))

vi.mock('../../src/store.js', () => ({
	store: { accounts: [], currentEnvelope: null, authError: null },
	accountFor: () => null,
	findMailbox: () => null,
}))

const base = {
	accountId: 1,
	mailboxId: 2,
	uid: 42,
	subject: 'Hello',
	from: [{ label: 'Alice', email: 'alice@example.com' }],
	to: [],
	cc: [],
	attachments: [],
}

async function open(message) {
	forgetEverything()
	const { fetchMessage } = await import('../../src/api/mail.js')
	fetchMessage.mockResolvedValue(message)
	const wrapper = mount(Reader, {
		propsData: { messageId: 9 },
		mocks: l10nMocks,
	})
	await new Promise((resolve) => setTimeout(resolve, 0))
	return wrapper
}

describe('mobile Reader keeps message content contained', () => {
	it('shows HTML mail in a frame where scripts cannot run', async () => {
		const wrapper = await open({ ...base, hasHtmlBody: true, body: '' })

		const sandbox = wrapper.find('iframe').attributes('sandbox')
		expect(sandbox).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox')
		expect(sandbox).not.toContain('allow-scripts')
	})

	it('shows plain-text mail as text, never as HTML', async () => {
		// What Mail sends for plain text: escaped, with links added. Even
		// if a future Mail stopped escaping, the markup must stay text.
		const body = 'Hi &lt;b&gt;there&lt;/b&gt;\nSee <a href="https://example.com/x">https://example.com/x</a>.\n'
			+ '<img src="https://tracker.example/p.png"><form><button>Confirm</button></form>'
		const wrapper = await open({ ...base, hasHtmlBody: false, body })

		const plain = wrapper.find('.reader__plain')
		expect(plain.text()).toContain('Hi <b>there</b>')
		expect(plain.find('b').exists()).toBe(false)
		expect(plain.find('img').exists()).toBe(false)
		expect(plain.find('form').exists()).toBe(false)
		const links = plain.findAll('a')
		expect(links.length).toBe(1)
		expect(links.at(0).attributes('href')).toBe('https://example.com/x')
		expect(links.at(0).attributes('rel')).toBe('noopener noreferrer')
	})

	it('forwards plain-text mail escaped by this app', async () => {
		const wrapper = await open({ ...base, hasHtmlBody: false, body: '&lt;script&gt;x&lt;/script&gt;\nline two' })

		wrapper.vm.forward()

		const html = wrapper.emitted('forward')[0][0].forwardedHtml
		expect(html).toContain('&lt;script&gt;x&lt;/script&gt;<br>line two')
		expect(html).not.toContain('<script>')
	})
})

describe('finding links in plain text', () => {
	it('links web and email addresses, leaving trailing punctuation out', () => {
		expect(linkify('Go to https://example.com/a?b=1. Or mail sam@example.com!')).toEqual([
			{ text: 'Go to ' },
			{ text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
			{ text: '. Or mail ' },
			{ text: 'sam@example.com', href: 'mailto:sam@example.com' },
			{ text: '!' },
		])
	})

	it('never links other schemes', () => {
		expect(linkify('javascript:alert(1) data:text/html,x')).toEqual([
			{ text: 'javascript:alert(1) data:text/html,x' },
		])
	})

	it('reads text out of markup without running or loading anything', () => {
		expect(htmlToText('a &amp; b<img src=x onerror="throw 1">')).toBe('a & b')
	})
})
