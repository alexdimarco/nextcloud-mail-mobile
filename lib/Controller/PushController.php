<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Controller;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Service\DeviceName;
use OCA\MailMobile\Service\Preferences;
use OCA\MailMobile\Service\PushService;
use OCA\MailMobile\Service\SessionToken;
use OCA\MailMobile\Service\VapidKeys;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IL10N;
use OCP\IRequest;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * Turning notifications on and off from the phone page.
 *
 * Everything that changes something keeps Nextcloud's anti-forgery check
 * (CSRF): the page sends its token with every request.
 */
class PushController extends Controller {
	public function __construct(
		IRequest $request,
		private ?string $userId,
		private PushService $pushService,
		private VapidKeys $vapidKeys,
		private SessionToken $sessionToken,
		private Preferences $preferences,
		private IL10N $l,
		private LoggerInterface $logger,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * The server's public push key, which browsers need to subscribe.
	 * Read-only and not secret, so no anti-forgery token is needed. It
	 * never makes keys: see VapidKeys.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function key(): JSONResponse {
		try {
			return new JSONResponse(['publicKey' => $this->vapidKeys->getPublicKey()]);
		} catch (Throwable $e) {
			$this->logger->error('Web push keys are not available: ' . $e->getMessage(), ['exception' => $e]);
			return new JSONResponse(['message' => 'Notifications are not set up on this server'], Http::STATUS_SERVICE_UNAVAILABLE);
		}
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 3600)]
	public function subscribe(#[\SensitiveParameter] string $endpoint, #[\SensitiveParameter] string $p256dh, #[\SensitiveParameter] string $auth): JSONResponse {
		if ($this->userId === null) {
			return new JSONResponse([], Http::STATUS_UNAUTHORIZED);
		}
		$result = $this->pushService->subscribe(
			$this->userId,
			$endpoint,
			$p256dh,
			$auth,
			$this->sessionToken->currentId(),
			DeviceName::fromUserAgent($this->request->getHeader('User-Agent')),
		);
		return match ($result) {
			PushService::SUBSCRIBED => new JSONResponse([]),
			PushService::CONFLICT => new JSONResponse(['message' => 'This push address belongs to another account'], Http::STATUS_CONFLICT),
			default => new JSONResponse(['message' => 'This push address is not accepted'], Http::STATUS_BAD_REQUEST),
		};
	}

	/**
	 * Whether this browser's push address is still registered to the
	 * person signed in now. A POST, so the address never lands in logs.
	 */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 120, period: 3600)]
	public function check(#[\SensitiveParameter] string $endpoint): JSONResponse {
		if ($this->userId === null) {
			return new JSONResponse([], Http::STATUS_UNAUTHORIZED);
		}
		return new JSONResponse([
			'subscribed' => $this->pushService->isSubscribed($this->userId, $endpoint, $this->sessionToken->currentId()),
		]);
	}

	#[NoAdminRequired]
	public function unsubscribe(#[\SensitiveParameter] string $endpoint): JSONResponse {
		if ($this->userId === null) {
			return new JSONResponse([], Http::STATUS_UNAUTHORIZED);
		}
		$this->pushService->unsubscribe($this->userId, $endpoint);
		return new JSONResponse([]);
	}

	#[NoAdminRequired]
	public function preferences(bool $showDetails): JSONResponse {
		if ($this->userId === null) {
			return new JSONResponse([], Http::STATUS_UNAUTHORIZED);
		}
		$this->preferences->setShowDetails($this->userId, $showDetails);
		return new JSONResponse(['showDetails' => $showDetails]);
	}

	/**
	 * Sent right away, not queued: the person is waiting to see whether
	 * notifications work on this phone.
	 */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 10, period: 600)]
	public function test(): JSONResponse {
		if ($this->userId === null) {
			return new JSONResponse([], Http::STATUS_UNAUTHORIZED);
		}
		$delivered = $this->pushService->pushToUser($this->userId, [[
			'title' => 'Mail Mobile',
			'body' => $this->l->t('Notifications are working'),
			'url' => '#/',
			'tag' => 'test',
		]]);
		return new JSONResponse(['delivered' => $delivered]);
	}
}
