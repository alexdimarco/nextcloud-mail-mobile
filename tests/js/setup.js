/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The small part of Nextcloud's page globals that the @nextcloud/*
// libraries read while the tests run

global.appVersion = '0.1.0'
global._oc_webroot = ''
global.OC = {
	getLocale: () => 'en',
	getLanguage: () => 'en',
	config: { version: '33.0.0', modRewriteWorking: false },
	isUserAdmin: () => false,
}
