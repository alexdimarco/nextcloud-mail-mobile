<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Service;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Vendor\Minishlink\WebPush\VAPID;
use OCP\IAppConfig;
use OCP\Security\ICrypto;
use Psr\Log\LoggerInterface;
use RuntimeException;
use Throwable;

/**
 * The server's own key pair for web push (called VAPID keys).
 *
 * Push services use the public key to check that notifications really
 * come from this server. The private key is stored encrypted with
 * Nextcloud's secret and marked sensitive, so it is hidden from config
 * listings and never appears in plain text in the database.
 *
 * Keys are only ever made in two places: the install (or upgrade) step,
 * and `occ mail_mobile:vapid:reset`. Reading never makes new keys: new keys
 * silently break every phone's subscription, so that must be an admin's
 * deliberate choice, and it removes the old subscriptions in the same step.
 */
class VapidKeys {
	public const CONFIG_PUBLIC = 'vapid_public';
	public const CONFIG_PRIVATE = 'vapid_private';

	public const STATE_OK = 'ok';
	public const STATE_MISSING = 'missing';
	/** Stored, but the private key cannot be decrypted (the server secret changed?) */
	public const STATE_UNREADABLE = 'unreadable';

	public function __construct(
		private IAppConfig $appConfig,
		private ICrypto $crypto,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @return self::STATE_* whether usable keys are stored
	 */
	public function state(): string {
		$public = $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_PUBLIC);
		$stored = $this->storedPrivateKey();
		if ($public === '' && $stored === '') {
			return self::STATE_MISSING;
		}
		if ($public === '' || $stored === '' || $this->decrypt($stored) === null) {
			return self::STATE_UNREADABLE;
		}
		return self::STATE_OK;
	}

	/**
	 * @throws RuntimeException when there are no usable keys
	 */
	public function getPublicKey(): string {
		return $this->getKeyPair()['publicKey'];
	}

	/**
	 * @return array{publicKey: string, privateKey: string}
	 * @throws RuntimeException when there are no usable keys
	 */
	public function getKeyPair(): array {
		$public = $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_PUBLIC);
		$private = $this->decrypt($this->storedPrivateKey());
		if ($public === '' || $private === null) {
			throw new RuntimeException('The web push keys are missing or cannot be decrypted. Run: occ mail_mobile:vapid:reset');
		}
		return ['publicKey' => $public, 'privateKey' => $private];
	}

	/**
	 * Make a new key pair and store it, replacing any old one. Only for the
	 * install step and the reset command, which also removes every
	 * subscription made with the old keys.
	 */
	public function create(): void {
		$keys = VAPID::createVapidKeys();
		// Delete first: a sensitive key cannot change its flags in place
		$this->appConfig->deleteKey(Application::APP_ID, self::CONFIG_PRIVATE);
		$this->appConfig->setValueString(
			Application::APP_ID,
			self::CONFIG_PRIVATE,
			$this->crypto->encrypt($keys['privateKey']),
			lazy: true,
			sensitive: true,
		);
		$this->appConfig->setValueString(Application::APP_ID, self::CONFIG_PUBLIC, $keys['publicKey']);
	}

	private function storedPrivateKey(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_PRIVATE, '', lazy: true);
	}

	private function decrypt(string $stored): ?string {
		if ($stored === '') {
			return null;
		}
		try {
			$private = $this->crypto->decrypt($stored);
			return $private !== '' ? $private : null;
		} catch (Throwable $e) {
			$this->logger->error('Could not decrypt the web push private key. Notifications are off until an admin runs: occ mail_mobile:vapid:reset', ['exception' => $e]);
			return null;
		}
	}
}
