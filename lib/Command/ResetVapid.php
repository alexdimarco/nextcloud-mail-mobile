<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Command;

use OCA\MailMobile\Db\PushSubscriptionMapper;
use OCA\MailMobile\Service\VapidKeys;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * occ mail_mobile:vapid:reset
 *
 * Makes a new web push key pair and removes every subscription, which only
 * worked with the old keys. Use it if the private key may have leaked.
 * Everyone then turns notifications on again on their phones.
 */
class ResetVapid extends Command {
	public function __construct(
		private VapidKeys $vapidKeys,
		private PushSubscriptionMapper $mapper,
	) {
		parent::__construct();
	}

	#[\Override]
	protected function configure(): void {
		$this->setName('mail_mobile:vapid:reset')
			->setDescription('Make new web push keys and remove all push subscriptions');
	}

	#[\Override]
	protected function execute(InputInterface $input, OutputInterface $output): int {
		$this->vapidKeys->create();
		$this->mapper->deleteAll();
		$output->writeln('New web push keys made. All push subscriptions were removed; people need to turn notifications on again.');
		return 0;
	}
}
