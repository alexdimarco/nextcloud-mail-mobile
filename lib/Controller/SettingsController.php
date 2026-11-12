<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Controller;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Service\Preferences;
use OCA\MailMobile\Service\PushService;
use OCA\MailMobile\Service\PushSubject;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\IAppConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use function trim;

/**
 * The plain forms on the settings pages. Each one posts here with
 * Nextcloud's anti-forgery token and comes back to the same page, so the
 * settings pages need no script of their own.
 */
class SettingsController extends Controller {
	public function __construct(
		IRequest $request,
		private ?string $userId,
		private Preferences $preferences,
		private PushService $pushService,
		private IAppConfig $appConfig,
		private IURLGenerator $urlGenerator,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	public function savePreferences(string $showDetails = ''): RedirectResponse {
		if ($this->userId !== null) {
			$this->preferences->setShowDetails($this->userId, $showDetails === '1');
		}
		return $this->backToPersonal();
	}

	#[NoAdminRequired]
	public function removeDevice(int $id): RedirectResponse {
		if ($this->userId !== null) {
			$this->pushService->removeDevice($this->userId, $id);
		}
		return $this->backToPersonal();
	}

	/**
	 * The contact address for push services. Admins only (the default for
	 * a route without NoAdminRequired).
	 */
	public function saveSubject(string $subject = ''): RedirectResponse {
		$subject = trim($subject);
		$valid = $subject === '' || PushSubject::isValid($subject);
		if ($subject === '') {
			$this->appConfig->deleteKey(Application::APP_ID, PushSubject::CONFIG_KEY);
		} elseif ($valid) {
			$this->appConfig->setValueString(Application::APP_ID, PushSubject::CONFIG_KEY, $subject);
		}
		$params = ['section' => 'additional'];
		if (!$valid) {
			$params['mailMobileSubjectError'] = '1';
		}
		return new RedirectResponse($this->urlGenerator->linkToRoute('settings.AdminSettings.index', $params) . '#mail-mobile-admin');
	}

	private function backToPersonal(): RedirectResponse {
		return new RedirectResponse($this->urlGenerator->linkToRoute('settings.PersonalSettings.index', ['section' => Application::APP_ID]) . '#mail-mobile-settings');
	}
}
