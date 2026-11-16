<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Service;

use OCA\MailMobile\Db\PushSubscription;
use OCA\MailMobile\Db\PushSubscriptionMapper;
use OCA\MailMobile\Vendor\Minishlink\WebPush\Subscription;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IURLGenerator;
use Psr\Log\LoggerInterface;
use Throwable;
use function array_keys;
use function hash;
use function is_string;
use function json_encode;
use function mb_substr;
use function parse_url;
use function preg_replace;
use function str_replace;
use function strlen;
use function substr;
use function usort;

/**
 * Stores the phones and browsers that asked for notifications, and sends
 * notifications to them.
 */
class PushService {
	/** Most subscriptions kept per user; the oldest is dropped first */
	public const MAX_SUBSCRIPTIONS_PER_USER = 20;
	/** Refusals in a row (401 or 403) after which a subscription is dropped */
	public const MAX_FAILURES = 3;

	public const SUBSCRIBED = 'subscribed';
	public const REJECTED = 'rejected';
	/** The push address is registered to another user */
	public const CONFLICT = 'conflict';

	public function __construct(
		private PushSubscriptionMapper $mapper,
		private VapidKeys $vapidKeys,
		private WebPushFactory $webPushFactory,
		private PushSubject $subject,
		private IURLGenerator $urlGenerator,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @param ?int $tokenId the sign-in that asks; the row is removed when it ends
	 * @param ?string $device a short name for the device list, such as "Chrome on Android"
	 * @return self::SUBSCRIBED|self::REJECTED|self::CONFLICT
	 */
	public function subscribe(string $userId, #[\SensitiveParameter] string $endpoint, #[\SensitiveParameter] string $p256dh, #[\SensitiveParameter] string $auth, ?int $tokenId = null, ?string $device = null): string {
		if (!EndpointPolicy::isAllowed($endpoint)) {
			$this->logger->warning('Rejected a push subscription to an address that is not a known push service');
			return self::REJECTED;
		}
		// Browser keys are short base64url strings; anything else is junk
		if ($p256dh === '' || strlen($p256dh) > 128 || $auth === '' || strlen($auth) > 64) {
			return self::REJECTED;
		}

		$hash = hash('sha256', $endpoint);
		$existing = $this->mapper->findByEndpointHash($hash);
		if ($existing !== null && $existing->getUserId() !== $userId) {
			// Any script on this server's pages can read a browser's push
			// address, so knowing it must not let one user remove another's
			// subscription. The phone page drops the old address and asks
			// the browser for a new one instead.
			return self::CONFLICT;
		}
		if ($existing !== null) {
			$this->mapper->delete($existing);
		} elseif ($this->mapper->countByUserId($userId) >= self::MAX_SUBSCRIPTIONS_PER_USER) {
			$this->mapper->deleteOldestForUser($userId);
		}

		$subscription = new PushSubscription();
		$subscription->setUserId($userId);
		$subscription->setEndpoint($endpoint);
		$subscription->setEndpointHash($hash);
		$subscription->setPubkey($p256dh);
		$subscription->setAuthToken($auth);
		$subscription->setCreatedAt($this->timeFactory->getTime());
		$subscription->setTokenId($tokenId);
		$subscription->setDevice($device !== null ? mb_substr($device, 0, 64) : null);
		$subscription->setFailures(0);
		$this->mapper->insert($subscription);
		return self::SUBSCRIBED;
	}

	/**
	 * Whether this push address is registered to this user. Also moves the
	 * row to the current sign-in: Nextcloud replaces a session's sign-in
	 * when it renews it, so the phone page reports the new one on each visit.
	 */
	public function isSubscribed(string $userId, #[\SensitiveParameter] string $endpoint, ?int $tokenId): bool {
		$existing = $this->mapper->findByEndpointHash(hash('sha256', $endpoint));
		if ($existing === null || $existing->getUserId() !== $userId) {
			return false;
		}
		if ($tokenId !== null && $existing->getTokenId() !== $tokenId) {
			$existing->setTokenId($tokenId);
			$this->mapper->update($existing);
		}
		return true;
	}

	public function unsubscribe(string $userId, #[\SensitiveParameter] string $endpoint): void {
		$this->mapper->deleteByEndpointHash($userId, hash('sha256', $endpoint));
	}

	public function hasSubscriptions(string $userId): bool {
		return $this->mapper->countByUserId($userId) > 0;
	}

	/**
	 * @return list<array{id: int, device: string, createdAt: int}> for the device list
	 */
	public function devices(string $userId): array {
		$devices = [];
		foreach ($this->mapper->findByUserId($userId) as $subscription) {
			$devices[] = [
				'id' => (int)$subscription->getId(),
				'device' => (string)($subscription->getDevice() ?? ''),
				'createdAt' => (int)$subscription->getCreatedAt(),
			];
		}
		usort($devices, static fn (array $a, array $b): int => $b['createdAt'] <=> $a['createdAt']);
		return $devices;
	}

	public function removeDevice(string $userId, int $id): void {
		$this->mapper->deleteByIdForUser($userId, $id);
	}

	/**
	 * A sign-in ended (sign-out, or the device was revoked in Security
	 * settings): stop notifications that it turned on.
	 */
	public function removeForToken(int $tokenId): void {
		$this->mapper->deleteByTokenId($tokenId);
	}

	public function removeAllForUser(string $userId): void {
		$this->mapper->deleteByUserId($userId);
	}

	/**
	 * Send notifications to every subscription of the user.
	 *
	 * This talks to outside push services, so it belongs in a background
	 * job, never in a request someone is waiting on (except the test button).
	 *
	 * @param list<array{title: string, body: string, url?: string, tag?: string}> $payloads
	 *                                                                                       url is only the part after "#"; the phone resolves it
	 * @return int how many notifications the push services accepted
	 */
	public function pushToUser(string $userId, #[\SensitiveParameter] array $payloads): int {
		if ($payloads === []) {
			return 0;
		}
		$subscriptions = $this->mapper->findByUserId($userId);
		if ($subscriptions === []) {
			return 0;
		}

		$subject = $this->subject->get();
		if ($subject === null) {
			// Still try: some push services accept it. The admin settings
			// page warns about this.
			$subject = $this->urlGenerator->getAbsoluteURL('/');
			$this->logger->warning('Mail Mobile has no usable contact address for push services. Set one under Administration settings → Mail Mobile.');
		}
		try {
			$keys = $this->vapidKeys->getKeyPair();
			$webPush = $this->webPushFactory->create([
				'subject' => $subject,
				'publicKey' => $keys['publicKey'],
				'privateKey' => $keys['privateKey'],
			]);
		} catch (Throwable $e) {
			// Without the exception itself: its trace holds the web push
			// library's constructor arguments, which include the private key
			$this->logger->error('Could not set up web push: ' . $e::class . ': ' . $e->getMessage());
			return 0;
		}

		/** @var array<string, PushSubscription> $byEndpoint */
		$byEndpoint = [];
		$delivered = 0;
		// Queueing hands push addresses and browser keys to the web push
		// library, so it is inside the same guard as sending: whatever goes
		// wrong is logged below without them, never as a raw exception
		try {
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

			foreach ($webPush->flush() as $report) {
				$endpoint = $report->getEndpoint();
				$subscription = $byEndpoint[$endpoint] ?? null;
				if ($report->isSuccess()) {
					$delivered++;
					if ($subscription !== null && $subscription->getFailures() > 0) {
						$subscription->setFailures(0);
						$this->mapper->update($subscription);
					}
					continue;
				}
				if ($subscription === null) {
					continue;
				}
				if ($report->isSubscriptionExpired()) {
					// The browser revoked or replaced this subscription
					$this->mapper->delete($subscription);
					unset($byEndpoint[$endpoint]);
					continue;
				}
				$status = $report->getResponse()?->getStatusCode();
				if ($status === 401 || $status === 403) {
					// The push service no longer accepts this server's key
					// for this subscription, for example after new keys
					$subscription->setFailures($subscription->getFailures() + 1);
					if ($subscription->getFailures() >= self::MAX_FAILURES) {
						$this->mapper->delete($subscription);
						unset($byEndpoint[$endpoint]);
						continue;
					}
					$this->mapper->update($subscription);
				}
				// Not the report's reason: it is the HTTP client's error
				// message, which contains the whole push address
				$this->logger->warning('Web push delivery failed for ' . self::describeEndpoint($endpoint) . ': '
					. ($status !== null ? 'HTTP ' . $status : 'no answer from the push service'));
			}
		} catch (Throwable $e) {
			// Without the exception itself: its message and trace can carry
			// push addresses, which would then be written to the log
			$this->logger->warning('Web push delivery failed: ' . $e::class . ': '
				. self::redact($e->getMessage(), array_keys($byEndpoint)));
		}
		return $delivered;
	}

	/**
	 * A push address as it may appear in logs: the push service's host and a
	 * short fingerprint, for example "push address 3fa2c91b07de at
	 * fcm.googleapis.com". The address itself lets anyone who has it (and
	 * this server's key) reach that device, so it never goes into a log. The
	 * fingerprint is the start of the subscription's endpoint_hash column,
	 * so an admin can still find the row.
	 */
	public static function describeEndpoint(#[\SensitiveParameter] string $endpoint): string {
		$host = parse_url($endpoint, PHP_URL_HOST);
		return 'push address ' . substr(hash('sha256', $endpoint), 0, 12)
			. ' at ' . (is_string($host) && $host !== '' ? $host : 'an unknown host');
	}

	/**
	 * Remove push addresses from an error message: the known ones become
	 * {@see self::describeEndpoint()}, and any other web address is dropped.
	 *
	 * @param list<string> $endpoints
	 */
	private static function redact(#[\SensitiveParameter] string $text, #[\SensitiveParameter] array $endpoints): string {
		foreach ($endpoints as $endpoint) {
			$text = str_replace($endpoint, self::describeEndpoint($endpoint), $text);
		}
		return (string)preg_replace('~https?://\S+~i', '[address removed]', $text);
	}
}
