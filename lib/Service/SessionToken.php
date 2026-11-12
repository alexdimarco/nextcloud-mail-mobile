<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Service;

use OCP\Authentication\Exceptions\ExpiredTokenException;
use OCP\Authentication\Exceptions\InvalidTokenException;
use OCP\Authentication\Exceptions\WipeTokenException;
use OCP\Authentication\Token\IProvider;
use OCP\ISession;
use OCP\Session\Exceptions\SessionNotAvailableException;
use function is_string;

/**
 * Finds the Nextcloud sign-in behind the current request: the browser
 * session, or an app password. Each notification subscription remembers
 * it, so the subscription can end when that sign-in ends.
 */
class SessionToken {
	public function __construct(
		private ISession $session,
		private IProvider $tokenProvider,
	) {
	}

	/**
	 * @return ?int the sign-in's id, or null when there is none to find
	 */
	public function currentId(): ?int {
		$candidates = [];
		try {
			$candidates[] = $this->session->getId();
		} catch (SessionNotAvailableException) {
			// No session (for example a script with an app password)
		}
		$candidates[] = $this->session->get('app_password');

		foreach ($candidates as $candidate) {
			if (!is_string($candidate) || $candidate === '') {
				continue;
			}
			try {
				return $this->tokenProvider->getToken($candidate)->getId();
			} catch (InvalidTokenException|ExpiredTokenException|WipeTokenException) {
				continue;
			}
		}
		return null;
	}
}
