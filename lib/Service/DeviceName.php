<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Service;

use function preg_match;

/**
 * A short, human name for a browser, such as "Chrome on Android", for the
 * device list in personal settings. Only the browser and system names are
 * kept, never the full browser description.
 */
class DeviceName {
	private const SYSTEMS = [
		'/iPhone/' => 'iPhone',
		'/iPad/' => 'iPad',
		'/Android/' => 'Android',
		'/Windows/' => 'Windows',
		'/Macintosh|Mac OS X/' => 'Mac',
		'/CrOS/' => 'ChromeOS',
		'/Linux/' => 'Linux',
	];

	private const BROWSERS = [
		'/Edg(A|iOS)?\//' => 'Edge',
		'/SamsungBrowser\//' => 'Samsung Internet',
		'/OPR\//' => 'Opera',
		'/Firefox\/|FxiOS\//' => 'Firefox',
		'/Chrome\/|CriOS\//' => 'Chrome',
		'/Safari\//' => 'Safari',
	];

	public static function fromUserAgent(string $userAgent): string {
		$browser = self::first(self::BROWSERS, $userAgent);
		$system = self::first(self::SYSTEMS, $userAgent);
		if ($browser !== null && $system !== null) {
			return $browser . ' on ' . $system;
		}
		return $browser ?? $system ?? 'Unknown browser';
	}

	/**
	 * @param array<non-empty-string, string> $patterns
	 */
	private static function first(array $patterns, string $userAgent): ?string {
		foreach ($patterns as $pattern => $name) {
			if (preg_match($pattern, $userAgent) === 1) {
				return $name;
			}
		}
		return null;
	}
}
