<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Service;

use OCA\MailMobile\AppInfo\Application;
use OCP\IAppConfig;
use OCP\IConfig;
use function filter_var;
use function str_starts_with;
use function strtolower;

/**
 * The contact address sent with every notification (the VAPID "subject").
 * Push services such as Apple's and Google's use it to reach the server's
 * operator, and some refuse an address that is not a mailto: or https://.
 *
 * Notifications are sent from cron, where Nextcloud only knows its own web
 * address from the "overwrite.cli.url" setting. So an admin sets a contact
 * address here (Administration settings, Mail Mobile); without one, that
 * setting is used if it is an https:// address.
 */
class PushSubject {
	public const CONFIG_KEY = 'push_subject';

	public function __construct(
		private IAppConfig $appConfig,
		private IConfig $config,
	) {
	}

	/** The address an admin set, or '' */
	public function configured(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY);
	}

	/**
	 * @return ?string the address to send, or null when none is usable
	 */
	public function get(): ?string {
		$configured = $this->configured();
		if (self::isValid($configured)) {
			return $configured;
		}
		$cliUrl = $this->config->getSystemValueString('overwrite.cli.url', '');
		return self::isValid($cliUrl) ? $cliUrl : null;
	}

	public static function isValid(string $subject): bool {
		$lower = strtolower($subject);
		if (str_starts_with($lower, 'mailto:')) {
			return filter_var(substr($subject, 7), FILTER_VALIDATE_EMAIL) !== false;
		}
		return str_starts_with($lower, 'https://') && filter_var($subject, FILTER_VALIDATE_URL) !== false;
	}
}
