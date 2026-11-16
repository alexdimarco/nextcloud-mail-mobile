<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\AppInfo;

use OCA\MailMobile\Listener\MailPageScriptListener;
use OCA\MailMobile\Listener\NewMailListener;
use OCA\MailMobile\Listener\SignInEndedListener;
use OCA\MailMobile\Listener\UserDeletedListener;
use OCA\MailMobile\Mail\MailBridge;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\Authentication\Events\TokenInvalidatedEvent;
use OCP\User\Events\PasswordUpdatedEvent;
use OCP\User\Events\UserDeletedEvent;

class Application extends App implements IBootstrap {
	public const APP_ID = 'mail_mobile';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	#[\Override]
	public function register(IRegistrationContext $context): void {
		// The web push library and its dependencies, renamed into
		// OCA\MailMobile\Vendor\ so they never clash with the copies
		// Nextcloud or other apps ship (see scoper.inc.php)
		$autoload = __DIR__ . '/../../vendor-scoped/autoload/autoload.php';
		if (is_file($autoload)) {
			require_once $autoload;
		}

		// Registered by class name: if Mail is missing, the event never
		// fires and this listener simply never runs
		$context->registerEventListener(MailBridge::NEW_MESSAGES_EVENT, NewMailListener::class);
		$context->registerEventListener(BeforeTemplateRenderedEvent::class, MailPageScriptListener::class);
		$context->registerEventListener(UserDeletedEvent::class, UserDeletedListener::class);
		$context->registerEventListener(TokenInvalidatedEvent::class, SignInEndedListener::class);
		$context->registerEventListener(PasswordUpdatedEvent::class, SignInEndedListener::class);
	}

	#[\Override]
	public function boot(IBootContext $context): void {
	}
}
