<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Service;

use function parse_url;
use function str_ends_with;
use function strlen;
use function strtolower;
use function substr;

/**
 * Which push addresses this server may send to.
 *
 * A phone hands us its push address when it subscribes, and the server
 * later sends to it. Without a check, anyone signed in could make the
 * server send requests to any address, including machines on its own
 * private network (a "server-side request forgery"). The web push library
 * uses its own HTTP client, so Nextcloud's own protection does not apply.
 * Only the browser push services below are allowed: Chrome, Edge and
 * Android (Google), Firefox (Mozilla), Safari and iPhone (Apple), and
 * Windows (Microsoft).
 */
final class EndpointPolicy {
	public const MAX_LENGTH = 2048;

	/** Exact hosts, or suffixes when they start with a dot */
	public const ALLOWED_HOSTS = [
		'fcm.googleapis.com',
		'android.googleapis.com',
		'.push.services.mozilla.com',
		'.notify.windows.com',
		'.wns.windows.com',
		'web.push.apple.com',
		'.push.apple.com',
	];

	public static function isAllowed(string $endpoint): bool {
		if ($endpoint === '' || strlen($endpoint) > self::MAX_LENGTH) {
			return false;
		}
		$parts = parse_url($endpoint);
		if ($parts === false || ($parts['scheme'] ?? '') !== 'https' || !isset($parts['host'])) {
			return false;
		}
		// No user:password@ or odd ports: real push services use neither
		if (isset($parts['user']) || isset($parts['pass']) || (isset($parts['port']) && $parts['port'] !== 443)) {
			return false;
		}
		$host = strtolower($parts['host']);
		foreach (self::ALLOWED_HOSTS as $allowed) {
			if ($allowed[0] === '.') {
				if (str_ends_with($host, $allowed) || $host === substr($allowed, 1)) {
					return true;
				}
			} elseif ($host === $allowed) {
				return true;
			}
		}
		return false;
	}
}
