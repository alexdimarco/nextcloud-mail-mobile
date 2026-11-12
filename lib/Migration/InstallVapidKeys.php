<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Migration;

use OCA\MailMobile\Service\VapidKeys;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;
use Throwable;

/**
 * Makes the server's web push key pair when the app is installed or
 * upgraded and no keys exist yet. Existing keys are never replaced here,
 * even unreadable ones: that would silently break every subscription.
 */
class InstallVapidKeys implements IRepairStep {
	public function __construct(
		private VapidKeys $vapidKeys,
	) {
	}

	#[\Override]
	public function getName(): string {
		return 'Create the web push keys for Mail Mobile';
	}

	#[\Override]
	public function run(IOutput $output): void {
		try {
			$state = $this->vapidKeys->state();
			if ($state === VapidKeys::STATE_MISSING) {
				$this->vapidKeys->create();
			} elseif ($state === VapidKeys::STATE_UNREADABLE) {
				$output->warning('The web push keys cannot be read. Notifications stay off until you run: occ mail_mobile:vapid:reset');
			}
		} catch (Throwable $e) {
			$output->warning('Could not create the web push keys. Notifications stay off until you run: occ mail_mobile:vapid:reset (' . $e->getMessage() . ')');
		}
	}
}
