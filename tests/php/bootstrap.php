<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

$root = dirname(__DIR__, 2);
require_once $root . '/vendor/autoload.php';

$scoped = $root . '/vendor-scoped/autoload/autoload.php';
if (!is_file($scoped)) {
	fwrite(STDERR, "vendor-scoped/ is missing. Run `composer scope` first.\n");
	exit(1);
}
require_once $scoped;

// Stand-ins for the few Mail classes MailBridge uses, and for the one
// Nextcloud server class OCP\Util calls
require_once __DIR__ . '/stubs/mail.php';
require_once __DIR__ . '/stubs/oc.php';
