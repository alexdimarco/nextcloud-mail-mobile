<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Tests\Unit\Service;

use OCA\MailMobile\Db\PushSubscription;
use OCA\MailMobile\Db\PushSubscriptionMapper;
use OCA\MailMobile\Service\PushService;
use OCA\MailMobile\Service\VapidKeys;
use OCA\MailMobile\Service\WebPushFactory;
use OCA\MailMobile\Vendor\GuzzleHttp\Handler\MockHandler;
use OCA\MailMobile\Vendor\GuzzleHttp\HandlerStack;
use OCA\MailMobile\Vendor\GuzzleHttp\Psr7\Response;
use OCA\MailMobile\Vendor\Minishlink\WebPush\VAPID;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IURLGenerator;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Sends to a fake network: every request the web push library makes is
 * answered by MockHandler, so the real signing and encryption run.
 */
class FakeNetworkWebPushFactory extends WebPushFactory {
	public function __construct(
		public MockHandler $network,
	) {
	}

	protected function clientOptions(): array {
		return ['handler' => HandlerStack::create($this->network)];
	}
}

class PushServiceTest extends TestCase {
	private PushSubscriptionMapper&MockObject $mapper;
	private VapidKeys&MockObject $vapidKeys;
	private MockHandler $network;
	private PushService $service;

	protected function setUp(): void {
		$this->mapper = $this->createMock(PushSubscriptionMapper::class);
		$this->vapidKeys = $this->createMock(VapidKeys::class);
		$this->vapidKeys->method('getKeyPair')->willReturn(VAPID::createVapidKeys());
		$this->network = new MockHandler();
		$urls = $this->createMock(IURLGenerator::class);
		$urls->method('getAbsoluteURL')->willReturn('https://cloud.example/');
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn(1_800_000_000);

		$this->service = new PushService(
			$this->mapper,
			$this->vapidKeys,
			new FakeNetworkWebPushFactory($this->network),
			$urls,
			$time,
			new NullLogger(),
		);
	}

	/**
	 * A subscription with real browser keys, made fresh for each test
	 */
	private function subscription(string $endpoint): PushSubscription {
		$key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
		$details = openssl_pkey_get_details($key);
		$point = "\x04" . str_pad($details['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($details['ec']['y'], 32, "\0", STR_PAD_LEFT);
		$b64 = static fn (string $bytes): string => rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');

		$subscription = new PushSubscription();
		$subscription->setUserId('sam');
		$subscription->setEndpoint($endpoint);
		$subscription->setEndpointHash(hash('sha256', $endpoint));
		$subscription->setPubkey($b64($point));
		$subscription->setAuthToken($b64(random_bytes(16)));
		$subscription->setCreatedAt(1);
		return $subscription;
	}

	public function testRejectsAnAddressThatIsNotAPushService(): void {
		$this->mapper->expects($this->never())->method('insert');
		$this->assertFalse($this->service->subscribe('sam', 'https://10.0.0.5/admin', 'key', 'auth'));
	}

	public function testRejectsJunkKeys(): void {
		$this->mapper->expects($this->never())->method('insert');
		$this->assertFalse($this->service->subscribe('sam', 'https://fcm.googleapis.com/fcm/send/a', '', 'auth'));
		$this->assertFalse($this->service->subscribe('sam', 'https://fcm.googleapis.com/fcm/send/a', 'key', str_repeat('a', 65)));
	}

	public function testStoresAValidSubscription(): void {
		$endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
		$this->mapper->expects($this->once())->method('deleteByEndpointHashAny')->with(hash('sha256', $endpoint));
		$this->mapper->method('countByUserId')->willReturn(0);
		$this->mapper->expects($this->never())->method('deleteOldestForUser');
		$this->mapper->expects($this->once())->method('insert')->with($this->callback(
			fn (PushSubscription $s) => $s->getUserId() === 'sam'
				&& $s->getEndpoint() === $endpoint
				&& $s->getPubkey() === 'key'
				&& $s->getAuthToken() === 'auth'
				&& $s->getCreatedAt() === 1_800_000_000,
		))->willReturnArgument(0);

		$this->assertTrue($this->service->subscribe('sam', $endpoint, 'key', 'auth'));
	}

	public function testDropsTheOldestWhenAUserHasTooMany(): void {
		$this->mapper->method('countByUserId')->willReturn(PushService::MAX_SUBSCRIPTIONS_PER_USER);
		$this->mapper->expects($this->once())->method('deleteOldestForUser')->with('sam');
		$this->mapper->method('insert')->willReturnArgument(0);

		$this->assertTrue($this->service->subscribe('sam', 'https://web.push.apple.com/abc', 'key', 'auth'));
	}

	public function testSendsSignedEncryptedNotifications(): void {
		$this->mapper->method('findByUserId')->willReturn([
			$this->subscription('https://fcm.googleapis.com/fcm/send/abc'),
		]);
		$this->network->append(new Response(201));

		$delivered = $this->service->pushToUser('sam', [['title' => 'Alice', 'body' => 'Lunch?']]);

		$this->assertSame(1, $delivered);
		$request = $this->network->getLastRequest();
		$this->assertSame('https://fcm.googleapis.com/fcm/send/abc', (string)$request->getUri());
		$this->assertSame('aes128gcm', $request->getHeaderLine('Content-Encoding'));
		$this->assertStringStartsWith('vapid t=', $request->getHeaderLine('Authorization'));
		// The content is encrypted for the browser; the push service cannot read it
		$this->assertStringNotContainsString('Lunch?', (string)$request->getBody());
	}

	public function testRemovesSubscriptionsThePushServiceSaysAreGone(): void {
		$gone = $this->subscription('https://updates.push.services.mozilla.com/wpush/v2/gone');
		$this->mapper->method('findByUserId')->willReturn([$gone]);
		$this->mapper->expects($this->once())->method('delete')->with($gone);
		$this->network->append(new Response(410));

		$this->assertSame(0, $this->service->pushToUser('sam', [['title' => 'x', 'body' => 'y']]));
	}

	public function testNeverSendsToAStoredAddressOutsideTheAllowlist(): void {
		$bad = $this->subscription('https://169.254.169.254/latest');
		$this->mapper->method('findByUserId')->willReturn([$bad]);
		$this->mapper->expects($this->once())->method('delete')->with($bad);

		$this->assertSame(0, $this->service->pushToUser('sam', [['title' => 'x', 'body' => 'y']]));
		$this->assertNull($this->network->getLastRequest());
	}

	public function testNothingToSendWithoutSubscriptions(): void {
		$this->mapper->method('findByUserId')->willReturn([]);
		$this->vapidKeys->expects($this->never())->method('getKeyPair');

		$this->assertSame(0, $this->service->pushToUser('sam', [['title' => 'x', 'body' => 'y']]));
	}
}
