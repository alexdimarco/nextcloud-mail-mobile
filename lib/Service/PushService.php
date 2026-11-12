<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Service;

use OCA\MailMobile\Db\PushSubscription;
use OCA\MailMobile\Db\PushSubscriptionMapper;
use OCA\MailMobile\Vendor\Minishlink\WebPush\Subscription;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IURLGenerator;
use Psr\Log\LoggerInterface;
use Throwable;
use function hash;
use function json_encode;
use function strlen;

/**
 * Stores the phones and browsers that asked for notifications, and sends
 * notifications to them.
 */
class PushService {
	/** Most subscriptions kept per user; the oldest is dropped first */
	public const MAX_SUBSCRIPTIONS_PER_USER = 20;

	public function __construct(
		private PushSubscriptionMapper $mapper,
		private VapidKeys $vapidKeys,
		private WebPushFactory $webPushFactory,
		private IURLGenerator $urlGenerator,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @return bool whether the subscription was accepted
	 */
	public function subscribe(string $userId, string $endpoint, string $p256dh, string $auth): bool {
		if (!EndpointPolicy::isAllowed($endpoint)) {
			$this->logger->warning('Rejected a push subscription to an address that is not a known push service');
			return false;
		}
		// Browser keys are short base64url strings; anything else is junk
		if ($p256dh === '' || strlen($p256dh) > 128 || $auth === '' || strlen($auth) > 64) {
			return false;
		}

		$hash = hash('sha256', $endpoint);
		// A push address belongs to exactly one browser. Replace any earlier
		// row for it (needed for the unique index, and for shared devices).
		// The address is an unguessable secret, so this cannot be used to
		// remove someone else's subscription.
		$this->mapper->deleteByEndpointHashAny($hash);

		if ($this->mapper->countByUserId($userId) >= self::MAX_SUBSCRIPTIONS_PER_USER) {
			$this->mapper->deleteOldestForUser($userId);
		}

		$subscription = new PushSubscription();
		$subscription->setUserId($userId);
		$subscription->setEndpoint($endpoint);
		$subscription->setEndpointHash($hash);
		$subscription->setPubkey($p256dh);
		$subscription->setAuthToken($auth);
		$subscription->setCreatedAt($this->timeFactory->getTime());
		$this->mapper->insert($subscription);
		return true;
	}

	public function unsubscribe(string $userId, string $endpoint): void {
		$this->mapper->deleteByEndpointHash($userId, hash('sha256', $endpoint));
	}

	public function hasSubscriptions(string $userId): bool {
		return $this->mapper->countByUserId($userId) > 0;
	}

	/**
	 * Send notifications to every subscription of the user.
	 *
	 * This talks to outside push services, so it belongs in a background
	 * job, never in a request someone is waiting on (except the test button).
	 *
	 * @param list<array{title: string, body: string, url?: string, tag?: string, icon?: string}> $payloads
	 * @return int how many notifications the push services accepted
	 */
	public function pushToUser(string $userId, array $payloads): int {
		if ($payloads === []) {
			return 0;
		}
		$subscriptions = $this->mapper->findByUserId($userId);
		if ($subscriptions === []) {
			return 0;
		}

		try {
			$keys = $this->vapidKeys->getKeyPair();
			$webPush = $this->webPushFactory->create([
				'subject' => $this->urlGenerator->getAbsoluteURL('/'),
				'publicKey' => $keys['publicKey'],
				'privateKey' => $keys['privateKey'],
			]);
		} catch (Throwable $e) {
			$this->logger->error('Could not set up web push: ' . $e->getMessage(), ['exception' => $e]);
			return 0;
		}

		/** @var array<string, PushSubscription> $byEndpoint */
		$byEndpoint = [];
		foreach ($subscriptions as $subscription) {
			// Checked again before every send, in case a row predates a
			// change to the allowlist
			if (!EndpointPolicy::isAllowed($subscription->getEndpoint())) {
				$this->mapper->delete($subscription);
				continue;
			}
			$byEndpoint[$subscription->getEndpoint()] = $subscription;
			foreach ($payloads as $payload) {
				$webPush->queueNotification(
					Subscription::create([
						'endpoint' => $subscription->getEndpoint(),
						'publicKey' => $subscription->getPubkey(),
						'authToken' => $subscription->getAuthToken(),
						'contentEncoding' => 'aes128gcm',
					]),
					(string)json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
				);
			}
		}
		if ($byEndpoint === []) {
			return 0;
		}

		$delivered = 0;
		try {
			foreach ($webPush->flush() as $report) {
				if ($report->isSuccess()) {
					$delivered++;
					continue;
				}
				$endpoint = $report->getEndpoint();
				if ($report->isSubscriptionExpired() && isset($byEndpoint[$endpoint])) {
					// The browser revoked or replaced this subscription
					$this->mapper->delete($byEndpoint[$endpoint]);
					unset($byEndpoint[$endpoint]);
					continue;
				}
				$this->logger->warning('Web push delivery failed: ' . $report->getReason());
			}
		} catch (Throwable $e) {
			$this->logger->warning('Web push delivery failed: ' . $e->getMessage(), ['exception' => $e]);
		}
		return $delivered;
	}
}
