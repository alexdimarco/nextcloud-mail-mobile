<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Listener;

use OCA\MailMobile\Service\PushService;
use OCP\Authentication\Events\TokenInvalidatedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\PasswordUpdatedEvent;

/**
 * Stop notifications when the sign-in that turned them on ends.
 *
 * - Signing out, or removing a device under Personal settings → Security,
 *   ends one sign-in: its subscriptions are removed.
 * - Changing the password removes all of the person's subscriptions; it is
 *   what people do when they think someone else has their account.
 *
 * @template-implements IEventListener<Event>
 */
class SignInEndedListener implements IEventListener {
	public function __construct(
		private PushService $pushService,
	) {
	}

	#[\Override]
	public function handle(Event $event): void {
		if ($event instanceof TokenInvalidatedEvent) {
			$this->pushService->removeForToken($event->getToken()->getId());
			return;
		}
		if ($event instanceof PasswordUpdatedEvent) {
			$this->pushService->removeAllForUser($event->getUser()->getUID());
		}
	}
}
