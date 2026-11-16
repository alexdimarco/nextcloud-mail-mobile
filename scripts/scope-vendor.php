<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Builds vendor-scoped/: the web push library and its dependencies,
// renamed into OCA\MailMobile\Vendor\ (see scoper.inc.php), with their own
// class loader at vendor-scoped/autoload/autoload.php, which
// lib/AppInfo/Application.php loads.
//
// Needs `composer install` first. Run with: composer scope

$root = dirname(__DIR__);
$out = $root . '/vendor-scoped';
$composer = getenv('COMPOSER_BINARY') ?: 'composer';

/**
 * @param list<string> $command
 */
function run(array $command, string $cwd): void {
	$process = proc_open($command, [STDIN, STDOUT, STDERR], $pipes, $cwd);
	if (!is_resource($process) || proc_close($process) !== 0) {
		fwrite(STDERR, 'Failed: ' . implode(' ', $command) . "\n");
		exit(1);
	}
}

function removeTree(string $path): void {
	if (!file_exists($path)) {
		return;
	}
	$items = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
		RecursiveIteratorIterator::CHILD_FIRST,
	);
	foreach ($items as $item) {
		$item->isDir() && !$item->isLink() ? rmdir($item->getPathname()) : unlink($item->getPathname());
	}
	rmdir($path);
}

removeTree($out);
mkdir($out, 0755, true);

run([PHP_BINARY, $root . '/vendor/bin/php-scoper', 'add-prefix', '--config=' . $root . '/scoper.inc.php', '--force', '--no-interaction', '--quiet'], $root);

// Files some packages always load (helper functions), now under src/
$lock = json_decode((string)file_get_contents($root . '/composer.lock'), true, 512, JSON_THROW_ON_ERROR);
$files = [];
foreach ($lock['packages'] as $package) {
	if (str_starts_with($package['name'], 'symfony/polyfill-')) {
		continue;
	}
	foreach ($package['autoload']['files'] ?? [] as $file) {
		$path = 'src/' . $package['name'] . '/' . $file;
		if (!is_file($out . '/' . $path)) {
			fwrite(STDERR, "Missing scoped file $path\n");
			exit(1);
		}
		$files[] = $path;
	}
}

file_put_contents($out . '/composer.json', json_encode([
	'autoload' => [
		'classmap' => ['src/'],
		'files' => $files,
	],
	'config' => [
		'vendor-dir' => 'autoload',
		'autoloader-suffix' => 'MailMobileVendor',
		'classmap-authoritative' => true,
	],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");

run([$composer, 'dump-autoload', '--classmap-authoritative', '--no-interaction', '--quiet', '--working-dir=' . $out], $root);

echo "Scoped dependencies written to vendor-scoped/\n";
