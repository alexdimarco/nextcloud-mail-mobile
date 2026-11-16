<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Service;

use OCA\MailMobile\AppInfo\Application;
use OCP\Config\IUserConfig;

/**
 * Each person's own Mail Mobile settings.
 */
class Preferences {
	public const SHOW_DETAILS = 'show_details';

	public function __construct(
		private IUserConfig $userConfig,
	) {
	}

	/**
	 * Whether notifications show the sender and subject. Off unless the
	 * person turns it on: phones show notifications on the lock screen.
	 */
	public function showDetails(string $userId): bool {
		return $this->userConfig->getValueBool($userId, Application::APP_ID, self::SHOW_DETAILS);
	}

	public function setShowDetails(string $userId, bool $show): void {
		$this->userConfig->setValueBool($userId, Application::APP_ID, self::SHOW_DETAILS, $show);
	}
}
