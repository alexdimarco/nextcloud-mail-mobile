/**
 * SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Adapted from the Nextcloud Mail app's vitest.config.js

import vue from '@vitejs/plugin-vue2'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [vue()],
	test: {
		include: ['tests/js/**/*.spec.js'],
		setupFiles: ['./tests/js/setup.js'],
		globals: true,
		environment: 'jsdom',
		// Needed to transform the CSS inside .vue files
		pool: 'vmForks',
	},
})
