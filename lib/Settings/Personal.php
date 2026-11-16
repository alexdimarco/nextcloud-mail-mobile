<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Settings;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Mail\MailBridge;
use OCA\MailMobile\Service\Preferences;
use OCA\MailMobile\Service\PushService;
use OCA\MailMobile\Service\SourceLink;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IDateTimeFormatter;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Settings\ISettings;

/**
 * Personal settings: the link to open on a phone, whether notifications
 * show sender and subject, and the devices that get notifications.
 */
class Personal implements ISettings {
	public function __construct(
		private IURLGenerator $urlGenerator,
		private IUserSession $userSession,
		private MailBridge $bridge,
		private Preferences $preferences,
		private PushService $pushService,
		private SourceLink $sourceLink,
		private IDateTimeFormatter $dateFormatter,
	) {
	}

	#[\Override]
	public function getForm(): TemplateResponse {
		$userId = $this->userSession->getUser()?->getUID();
		$status = $this->bridge->status($userId);
		$devices = [];
		foreach ($userId !== null ? $this->pushService->devices($userId) : [] as $device) {
			$devices[] = [
				'id' => $device['id'],
				'device' => $device['device'],
				'added' => $this->dateFormatter->formatDate($device['createdAt']),
				'removeUrl' => $this->urlGenerator->linkToRoute('mail_mobile.settings.removeDevice', ['id' => $device['id']]),
			];
		}
		return new TemplateResponse(Application::APP_ID, 'settings-personal', [
			'url' => $this->urlGenerator->linkToRouteAbsolute('mail_mobile.page.index'),
			'usable' => $status->usable,
			'found' => $status->found,
			'showDetails' => $userId !== null && $this->preferences->showDetails($userId),
			'preferencesUrl' => $this->urlGenerator->linkToRoute('mail_mobile.settings.savePreferences'),
			'devices' => $devices,
			'sourceUrl' => $this->sourceLink->url(),
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
