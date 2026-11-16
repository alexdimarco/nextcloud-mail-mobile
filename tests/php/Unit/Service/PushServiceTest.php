<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Tests\Unit\Service;

use OCA\MailMobile\Db\PushSubscription;
use OCA\MailMobile\Db\PushSubscriptionMapper;
use OCA\MailMobile\Service\PushService;
use OCA\MailMobile\Service\PushSubject;
use OCA\MailMobile\Service\VapidKeys;
use OCA\MailMobile\Service\WebPushFactory;
use OCA\MailMobile\Vendor\GuzzleHttp\Exception\ConnectException;
use OCA\MailMobile\Vendor\GuzzleHttp\Handler\MockHandler;
use OCA\MailMobile\Vendor\GuzzleHttp\HandlerStack;
use OCA\MailMobile\Vendor\GuzzleHttp\Psr7\Request;
use OCA\MailMobile\Vendor\GuzzleHttp\Psr7\Response;
use OCA\MailMobile\Vendor\Minishlink\WebPush\VAPID;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IURLGenerator;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Psr\Log\LoggerTrait;
use Stringable;

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

/**
 * Keeps every log line, with the messages of any exceptions passed along,
 * so a test can check what would have been written to the log.
 */
class RecordingLogger implements LoggerInterface {
	use LoggerTrait;

	/** @var list<string> */
	public array $lines = [];

	public function log($level, string|Stringable $message, array $context = []): void {
		$line = $level . ': ' . $message;
		foreach ($context as $value) {
			if ($value instanceof \Throwable) {
				$line .= ' | ' . $value->getMessage() . ' | ' . $value->getTraceAsString();
			}
		}
		$this->lines[] = $line;
	}
}

class PushServiceTest extends TestCase {
	private RecordingLogger $logger;
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
		$urls->method('getAbsoluteURL')->willReturn('http://localhost/');
		$subject = $this->createMock(PushSubject::class);
		$subject->method('get')->willReturn('mailto:admin@example.com');
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn(1_800_000_000);
		$this->logger = new RecordingLogger();

		$this->service = new PushService(
			$this->mapper,
			$this->vapidKeys,
			new FakeNetworkWebPushFactory($this->network),
			$subject,
			$urls,
			$time,
			$this->logger,
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
		$subscription->setFailures(0);
		return $subscription;
	}

	public function testRejectsAnAddressThatIsNotAPushService(): void {
		$this->mapper->expects($this->never())->method('insert');
		$this->assertSame(PushService::REJECTED, $this->service->subscribe('sam', 'https://10.0.0.5/admin', 'key', 'auth'));
	}

	public function testRejectsJunkKeys(): void {
		$this->mapper->expects($this->never())->method('insert');
		$this->assertSame(PushService::REJECTED, $this->service->subscribe('sam', 'https://fcm.googleapis.com/fcm/send/a', '', 'auth'));
		$this->assertSame(PushService::REJECTED, $this->service->subscribe('sam', 'https://fcm.googleapis.com/fcm/send/a', 'key', str_repeat('a', 65)));
	}

	public function testStoresAValidSubscription(): void {
		$endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
		$this->mapper->expects($this->once())->method('findByEndpointHash')->with(hash('sha256', $endpoint))->willReturn(null);
		$this->mapper->method('countByUserId')->willReturn(0);
		$this->mapper->expects($this->never())->method('deleteOldestForUser');
		$this->mapper->expects($this->once())->method('insert')->with($this->callback(
			fn (PushSubscription $s) => $s->getUserId() === 'sam'
				&& $s->getEndpoint() === $endpoint
				&& $s->getPubkey() === 'key'
				&& $s->getAuthToken() === 'auth'
				&& $s->getCreatedAt() === 1_800_000_000
				&& $s->getTokenId() === 55
				&& $s->getDevice() === 'Firefox on Android',
		))->willReturnArgument(0);

		$this->assertSame(PushService::SUBSCRIBED, $this->service->subscribe('sam', $endpoint, 'key', 'auth', 55, 'Firefox on Android'));
	}

	public function testReplacesTheSameUsersEarlierRowForTheAddress(): void {
		$endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
		$old = $this->subscription($endpoint);
		$this->mapper->method('findByEndpointHash')->willReturn($old);
		$this->mapper->expects($this->once())->method('delete')->with($old);
		$this->mapper->expects($this->never())->method('deleteOldestForUser');
		$this->mapper->expects($this->once())->method('insert')->willReturnArgument(0);

		$this->assertSame(PushService::SUBSCRIBED, $this->service->subscribe('sam', $endpoint, 'key', 'auth'));
	}

	public function testRefusesAnAddressRegisteredToAnotherUser(): void {
		$endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
		$theirs = $this->subscription($endpoint);
		$theirs->setUserId('alex');
		$this->mapper->method('findByEndpointHash')->willReturn($theirs);
		$this->mapper->expects($this->never())->method('delete');
		$this->mapper->expects($this->never())->method('insert');

		$this->assertSame(PushService::CONFLICT, $this->service->subscribe('sam', $endpoint, 'key', 'auth'));
	}

	public function testChecksAnAddressAndMovesItToTheCurrentSignIn(): void {
		$endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
		$mine = $this->subscription($endpoint);
		$mine->setTokenId(1);
		$this->mapper->method('findByEndpointHash')->willReturn($mine);
		$this->mapper->expects($this->once())->method('update')->with($this->callback(fn (PushSubscription $s) => $s->getTokenId() === 2));

		$this->assertTrue($this->service->isSubscribed('sam', $endpoint, 2));
		$this->assertFalse($this->service->isSubscribed('alex', $endpoint, 2), 'another user\'s address is not theirs');
	}

	public function testUnknownAddressIsNotSubscribed(): void {
		$this->mapper->method('findByEndpointHash')->willReturn(null);
		$this->assertFalse($this->service->isSubscribed('sam', 'https://fcm.googleapis.com/fcm/send/x', 2));
	}

	public function testDropsASubscriptionAfterRepeatedRefusals(): void {
		$refused = $this->subscription('https://fcm.googleapis.com/fcm/send/old-keys');
		$refused->setFailures(PushService::MAX_FAILURES - 1);
		$this->mapper->method('findByUserId')->willReturn([$refused]);
		$this->mapper->expects($this->once())->method('delete')->with($refused);
		$this->network->append(new Response(403));

		$this->assertSame(0, $this->service->pushToUser('sam', [['title' => 'x', 'body' => 'y']]));
	}

	public function testCountsAFirstRefusalWithoutDropping(): void {
		$refused = $this->subscription('https://fcm.googleapis.com/fcm/send/old-keys');
		$this->mapper->method('findByUserId')->willReturn([$refused]);
		$this->mapper->expects($this->never())->method('delete');
		$this->mapper->expects($this->once())->method('update')->with($this->callback(fn (PushSubscription $s) => $s->getFailures() === 1));
		$this->network->append(new Response(401));

		$this->service->pushToUser('sam', [['title' => 'x', 'body' => 'y']]);
	}

	public function testUsesTheConfiguredContactAddress(): void {
		$this->mapper->method('findByUserId')->willReturn([
			$this->subscription('https://fcm.googleapis.com/fcm/send/abc'),
		]);
		$this->network->append(new Response(201));

		$this->service->pushToUser('sam', [['title' => 'x', 'body' => 'y']]);

		// The signed token names the contact address, not http://localhost/
		$authorization = $this->network->getLastRequest()->getHeaderLine('Authorization');
		preg_match('/t=([^,]+)/', $authorization, $match);
		$claims = json_decode(base64_decode(strtr(explode('.', $match[1])[1], '-_', '+/')), true);
		$this->assertSame('mailto:admin@example.com', $claims['sub']);
	}

	public function testDropsTheOldestWhenAUserHasTooMany(): void {
		$this->mapper->method('countByUserId')->willReturn(PushService::MAX_SUBSCRIPTIONS_PER_USER);
		$this->mapper->expects($this->once())->method('deleteOldestForUser')->with('sam');
		$this->mapper->method('insert')->willReturnArgument(0);

		$this->mapper->method('findByEndpointHash')->willReturn(null);
		$this->assertSame(PushService::SUBSCRIBED, $this->service->subscribe('sam', 'https://web.push.apple.com/abc', 'key', 'auth'));
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

	public function testLogsOnlyAFingerprintOfTheAddressWhenASendFails(): void {
		$endpoint = 'https://fcm.googleapis.com/fcm/send/secret-device-token';
		$this->mapper->method('findByUserId')->willReturn([$this->subscription($endpoint)]);
		$this->network->append(new Response(500, [], 'error for /fcm/send/secret-device-token'));

		$this->assertSame(0, $this->service->pushToUser('sam', [['title' => 'x', 'body' => 'y']]));

		$fingerprint = substr(hash('sha256', $endpoint), 0, 12);
		$this->assertSame(
			['warning: Web push delivery failed for push address ' . $fingerprint . ' at fcm.googleapis.com: HTTP 500'],
			$this->logger->lines,
		);
	}

	public function testLogsNoAddressWhenThePushServiceCannotBeReached(): void {
		$endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/secret-device-token';
		$this->mapper->method('findByUserId')->willReturn([$this->subscription($endpoint)]);
		// The HTTP client's own message names the whole address
		$this->network->append(new ConnectException('Could not reach ' . $endpoint, new Request('POST', $endpoint)));

		$this->service->pushToUser('sam', [['title' => 'x', 'body' => 'y']]);

		$this->assertCount(1, $this->logger->lines);
		$this->assertStringContainsString('at updates.push.services.mozilla.com: no answer from the push service', $this->logger->lines[0]);
		$this->assertStringNotContainsString('secret-device-token', $this->logger->lines[0]);
	}

	public function testDescribesAnAddressWithoutRevealingIt(): void {
		$endpoint = 'https://web.push.apple.com/QGsecret-device-token';
		$this->assertSame(
			'push address ' . substr(hash('sha256', $endpoint), 0, 12) . ' at web.push.apple.com',
			PushService::describeEndpoint($endpoint),
		);
		$this->assertSame('push address ' . substr(hash('sha256', 'not a url'), 0, 12) . ' at an unknown host', PushService::describeEndpoint('not a url'));
	}

	public function testNothingToSendWithoutSubscriptions(): void {
		$this->mapper->method('findByUserId')->willReturn([]);
		$this->vapidKeys->expects($this->never())->method('getKeyPair');

		$this->assertSame(0, $this->service->pushToUser('sam', [['title' => 'x', 'body' => 'y']]));
	}
}
