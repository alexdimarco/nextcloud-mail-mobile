<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Service;

use OCA\MailMobile\Vendor\Minishlink\WebPush\WebPush;

/**
 * Builds the web push client. A separate class so tests can hand the
 * client a fake network instead of real push services.
 */
class WebPushFactory {
	/** Seconds to wait on a push service before giving up */
	public const TIMEOUT = 10;

	/**
	 * @param array{subject: string, publicKey: string, privateKey: string} $vapid
	 */
	public function create(array $vapid): WebPush {
		return new WebPush(['VAPID' => $vapid], [], self::TIMEOUT, $this->clientOptions());
	}

	/**
	 * Extra options for the HTTP client (Guzzle)
	 *
	 * @return array<string, mixed>
	 */
	protected function clientOptions(): array {
		return [
			// Push services are always https; never follow a redirect elsewhere
			'allow_redirects' => false,
		];
	}
}
