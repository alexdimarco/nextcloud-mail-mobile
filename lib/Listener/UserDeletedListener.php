<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Listener;

use OCA\MailMobile\Db\PushSubscriptionMapper;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserDeletedEvent;

/**
 * Remove a deleted user's push subscriptions.
 *
 * @template-implements IEventListener<Event>
 */
class UserDeletedListener implements IEventListener {
	public function __construct(
		private PushSubscriptionMapper $mapper,
	) {
	}

	#[\Override]
	public function handle(Event $event): void {
		if (!$event instanceof UserDeletedEvent) {
			return;
		}
		$this->mapper->deleteByUserId($event->getUser()->getUID());
	}
}
