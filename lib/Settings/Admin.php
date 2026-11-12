<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Settings;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Service\PushSubject;
use OCA\MailMobile\Service\VapidKeys;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\Settings\ISettings;

/**
 * Administration settings: the contact address push services require,
 * and a warning when notifications cannot work.
 */
class Admin implements ISettings {
	public function __construct(
		private PushSubject $subject,
		private VapidKeys $vapidKeys,
		private IURLGenerator $urlGenerator,
		private IRequest $request,
	) {
	}

	#[\Override]
	public function getForm(): TemplateResponse {
		return new TemplateResponse(Application::APP_ID, 'settings-admin', [
			'configured' => $this->subject->configured(),
			'effective' => $this->subject->get(),
			'keysState' => $this->vapidKeys->state(),
			'saveUrl' => $this->urlGenerator->linkToRoute('mail_mobile.settings.saveSubject'),
			'invalid' => $this->request->getParam('mailMobileSubjectError') === '1',
		], '');
	}

	#[\Override]
	public function getSection(): string {
		return 'additional';
	}

	#[\Override]
	public function getPriority(): int {
		return 50;
	}
}
