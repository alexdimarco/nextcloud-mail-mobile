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
 */
class VapidKeys {
	public const CONFIG_PUBLIC = 'vapid_public';
	public const CONFIG_PRIVATE = 'vapid_private';

	public function __construct(
		private IAppConfig $appConfig,
		private ICrypto $crypto,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * The public key, created on first use if the install step did not run.
	 */
	public function getPublicKey(): string {
		$public = $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_PUBLIC);
		if ($public !== '' && $this->readPrivateKey() !== '') {
			return $public;
		}
		$this->create();
		return $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_PUBLIC);
	}

	/**
	 * @return array{publicKey: string, privateKey: string}
	 */
	public function getKeyPair(): array {
		$public = $this->getPublicKey();
		$private = $this->readPrivateKey();
		if ($private === '') {
			throw new RuntimeException('The web push private key is missing');
		}
		return ['publicKey' => $public, 'privateKey' => $private];
	}

	public function exists(): bool {
		return $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_PUBLIC) !== ''
			&& $this->readPrivateKey() !== '';
	}

	/**
	 * Make a new key pair and store it, replacing any old one.
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

	private function readPrivateKey(): string {
		$stored = $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_PRIVATE, '', lazy: true);
		if ($stored === '') {
			return '';
		}
		try {
			return $this->crypto->decrypt($stored);
		} catch (Throwable $e) {
			// For example after the server secret changed: make new keys
			$this->logger->warning('Could not decrypt the web push private key; new keys will be made', ['exception' => $e]);
			return '';
		}
	}
}
