<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

return [
	'routes' => [
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
		['name' => 'page#manifest', 'url' => '/manifest.webmanifest', 'verb' => 'GET'],
		['name' => 'page#serviceWorker', 'url' => '/sw.js', 'verb' => 'GET'],
		['name' => 'push#key', 'url' => '/push/key', 'verb' => 'GET'],
		['name' => 'push#subscribe', 'url' => '/push', 'verb' => 'POST'],
		['name' => 'push#unsubscribe', 'url' => '/push', 'verb' => 'DELETE'],
		['name' => 'push#test', 'url' => '/push/test', 'verb' => 'POST'],
		['name' => 'push#check', 'url' => '/push/check', 'verb' => 'POST'],
		['name' => 'push#preferences', 'url' => '/push/preferences', 'verb' => 'PUT'],
		['name' => 'settings#savePreferences', 'url' => '/settings/preferences', 'verb' => 'POST'],
		['name' => 'settings#removeDevice', 'url' => '/settings/devices/{id}/remove', 'verb' => 'POST'],
		['name' => 'settings#saveSubject', 'url' => '/settings/subject', 'verb' => 'POST'],
	],
];
