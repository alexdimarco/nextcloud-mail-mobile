<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Settings for php-scoper, which renames the web push library and
// everything it needs into OCA\MailMobile\Vendor\. Nextcloud ships its own
// copies of some of them (Guzzle, for example); renaming means two copies
// can never clash. Run it with: composer scope

use Isolated\Symfony\Component\Finder\Finder;

// The runtime packages are the "packages" (not "packages-dev") in
// composer.lock. The PHP polyfills are left out: this app needs PHP 8.2 or
// newer, which already has everything they add.
$lock = json_decode((string)file_get_contents(__DIR__ . '/composer.lock'), true, 512, JSON_THROW_ON_ERROR);
$dirs = [];
foreach ($lock['packages'] as $package) {
	if (str_starts_with($package['name'], 'symfony/polyfill-')) {
		continue;
	}
	$dirs[] = __DIR__ . '/vendor/' . $package['name'];
}

return [
	'prefix' => 'OCA\\MailMobile\\Vendor',
	'output-dir' => __DIR__ . '/vendor-scoped/src',
	'finders' => [
		Finder::create()
			->files()
			->ignoreVCS(true)
			->name(['*.php', 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'composer.json'])
			->notPath('#^(tests?|Tests?|docs?|examples?)/#')
			->in($dirs),
	],
	'exclude-namespaces' => [
		// PHP's own classes and the ones Nextcloud provides itself
		'Composer',
	],
	'expose-global-constants' => false,
	'expose-global-classes' => false,
	'expose-global-functions' => false,
];
