<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Settings;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Mail\MailBridge;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Settings\ISettings;

/**
 * Personal settings: the link to open on a phone.
 */
class Personal implements ISettings {
	public function __construct(
		private IURLGenerator $urlGenerator,
		private IUserSession $userSession,
		private MailBridge $bridge,
	) {
	}

	#[\Override]
	public function getForm(): TemplateResponse {
		$status = $this->bridge->status($this->userSession->getUser()?->getUID());
		return new TemplateResponse(Application::APP_ID, 'settings-personal', [
			'url' => $this->urlGenerator->linkToRouteAbsolute('mail_mobile.page.index'),
			'usable' => $status->usable,
			'found' => $status->found,
		], '');
	}

	#[\Override]
	public function getSection(): string {
		return Application::APP_ID;
	}

	#[\Override]
	public function getPriority(): int {
		return 50;
	}
}
