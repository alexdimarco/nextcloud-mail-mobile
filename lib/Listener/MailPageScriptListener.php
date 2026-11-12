<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Listener;

use OCA\MailMobile\AppInfo\Application;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * Brings people back to the phone page after they sign in again.
 *
 * When a session runs out on the phone page, it leaves a short-lived
 * marker and reloads. Some single sign-on (SSO) services lose the page
 * address on the way and land on the full Mail app instead. This adds a
 * tiny script to Mail's own page that sees the marker and goes back.
 * It is added only to Mail's main page and does nothing without the marker.
 *
 * @template-implements IEventListener<Event>
 */
class MailPageScriptListener implements IEventListener {
	public const SCRIPT = 'mail_mobile-reauth';

	#[\Override]
	public function handle(Event $event): void {
		if (!$event instanceof BeforeTemplateRenderedEvent || !$event->isLoggedIn()) {
			return;
		}
		if (!self::isMailMainPage($event->getResponse()->getApp(), (string)$event->getResponse()->getTemplateName())) {
			return;
		}
		Util::addScript(Application::APP_ID, self::SCRIPT);
	}

	public static function isMailMainPage(string $app, string $template): bool {
		return $app === 'mail' && $template === 'index';
	}
}
