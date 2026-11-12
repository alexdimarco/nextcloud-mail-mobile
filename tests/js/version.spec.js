/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The page compares the version built into the bundle (package.json) with
// the version the server reports (appinfo/info.xml) to spot an old cached
// copy, so the two must always match.
describe('version numbers', () => {
	it('match between package.json and info.xml', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
		const info = readFileSync('appinfo/info.xml', 'utf8')
		const match = info.match(/<version>([^<]+)<\/version>/)
		expect(match?.[1]).toBe(pkg.version)
	})
})
