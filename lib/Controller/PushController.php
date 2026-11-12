<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Controller;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Service\PushService;
use OCA\MailMobile\Service\VapidKeys;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
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
		private IURLGenerator $urlGenerator,
		private IL10N $l,
		private LoggerInterface $logger,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * The server's public push key, which browsers need to subscribe.
	 * Read-only and not secret, so no anti-forgery token is needed.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function key(): JSONResponse {
		try {
			return new JSONResponse(['publicKey' => $this->vapidKeys->getPublicKey()]);
		} catch (Throwable $e) {
			$this->logger->error('Could not load or create the web push keys: ' . $e->getMessage(), ['exception' => $e]);
			return new JSONResponse(['message' => 'Push keys are not available'], Http::STATUS_INTERNAL_SERVER_ERROR);
		}
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 3600)]
	public function subscribe(string $endpoint, string $p256dh, string $auth): JSONResponse {
		if ($this->userId === null) {
			return new JSONResponse([], Http::STATUS_UNAUTHORIZED);
		}
		if (!$this->pushService->subscribe($this->userId, $endpoint, $p256dh, $auth)) {
			return new JSONResponse(['message' => 'This push address is not accepted'], Http::STATUS_BAD_REQUEST);
		}
		return new JSONResponse([]);
	}

	#[NoAdminRequired]
	public function unsubscribe(string $endpoint): JSONResponse {
		if ($this->userId === null) {
			return new JSONResponse([], Http::STATUS_UNAUTHORIZED);
		}
		$this->pushService->unsubscribe($this->userId, $endpoint);
		return new JSONResponse([]);
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
			'url' => $this->urlGenerator->linkToRouteAbsolute('mail_mobile.page.index'),
			'tag' => 'test',
			'icon' => $this->urlGenerator->getAbsoluteURL($this->urlGenerator->imagePath(Application::APP_ID, 'icon-192.png')),
		]]);
		return new JSONResponse(['delivered' => $delivered]);
	}
}
