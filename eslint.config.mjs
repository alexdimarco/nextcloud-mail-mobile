/**
 * SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Adapted from the Nextcloud Mail app's eslint.config.mjs

import { recommendedVue2 } from '@nextcloud/eslint-config'
import { defineConfig } from 'eslint/config'

export default defineConfig([
	...recommendedVue2,
	{
		languageOptions: {
			globals: {
				appVersion: 'readonly',
				__webpack_nonce__: 'writable',
				__webpack_public_path__: 'writable',
			},
		},
		rules: {
			'no-console': 'error',
			'jsdoc/require-jsdoc': 'off',
			'vue/multi-word-component-names': 'off',
		},
	},
	{
		files: ['tests/js/**'],
		languageOptions: {
			globals: {
				describe: 'readonly',
				it: 'readonly',
				expect: 'readonly',
				beforeEach: 'readonly',
				afterEach: 'readonly',
				vi: 'readonly',
				global: 'writable',
			},
		},
	},
])
