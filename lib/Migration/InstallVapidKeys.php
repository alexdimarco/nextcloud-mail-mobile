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
 * Makes the server's web push key pair when the app is installed.
 * If this fails, the keys are made on first use instead.
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
			if (!$this->vapidKeys->exists()) {
				$this->vapidKeys->create();
			}
		} catch (Throwable $e) {
			$output->warning('Could not create the web push keys now; they will be created on first use: ' . $e->getMessage());
		}
	}
}
