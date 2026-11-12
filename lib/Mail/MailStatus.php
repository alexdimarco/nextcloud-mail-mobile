<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Mail;

/**
 * Whether the Mail app can be used, with a plain reason when it cannot.
 */
final class MailStatus {
	private function __construct(
		public readonly bool $usable,
		public readonly ?string $mailVersion,
		public readonly string $found,
	) {
	}

	public static function usable(string $version): self {
		return new self(true, $version, 'Mail ' . $version);
	}

	public static function unusable(?string $version, string $found): self {
		return new self(false, $version, $found);
	}
}
