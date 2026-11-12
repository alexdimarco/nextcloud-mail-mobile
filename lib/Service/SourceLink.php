<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Service;

use OCA\MailMobile\AppInfo\Application;
use OCP\App\IAppManager;
use Throwable;
use function is_array;
use function is_string;
use function str_contains;
use function str_starts_with;

/**
 * The address of this app's source code, from appinfo/info.xml.
 *
 * The AGPL licence asks that people who use the app over the network can
 * get its source, so the phone page and the settings page link to it.
 */
class SourceLink {
	/** Left in info.xml until the public repository exists */
	public const PLACEHOLDER = '/OWNER/';

	public function __construct(
		private IAppManager $appManager,
	) {
	}

	/**
	 * @return string the https address, or '' while info.xml has the placeholder
	 */
	public function url(): string {
		try {
			$info = $this->appManager->getAppInfo(Application::APP_ID);
		} catch (Throwable) {
			return '';
		}
		$repository = is_array($info) ? ($info['repository'] ?? null) : null;
		if (is_array($repository)) {
			$repository = $repository['@value'] ?? null;
		}
		if (!is_string($repository) || !str_starts_with($repository, 'https://') || str_contains($repository, self::PLACEHOLDER)) {
			return '';
		}
		return $repository;
	}
}
