<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Tests\Unit\Controller;

use OCA\MailMobile\Controller\PushController;
use OCA\MailMobile\Service\Preferences;
use OCA\MailMobile\Service\PushService;
use OCA\MailMobile\Service\SessionToken;
use OCA\MailMobile\Service\VapidKeys;
use OCP\AppFramework\Http;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use RuntimeException;

class PushControllerTest extends TestCase {
	private PushService&MockObject $pushService;
	private VapidKeys&MockObject $vapidKeys;
	private Preferences&MockObject $preferences;

	protected function setUp(): void {
		$this->pushService = $this->createMock(PushService::class);
		$this->vapidKeys = $this->createMock(VapidKeys::class);
		$this->preferences = $this->createMock(Preferences::class);
	}

	private function controller(?string $userId = 'sam'): PushController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		$request = $this->createMock(IRequest::class);
		$request->method('getHeader')->willReturnMap([
			['User-Agent', 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36'],
		]);
		$token = $this->createMock(SessionToken::class);
		$token->method('currentId')->willReturn(55);
		return new PushController(
			$request,
			$userId,
			$this->pushService,
			$this->vapidKeys,
			$token,
			$this->preferences,
			$l,
			new NullLogger(),
		);
	}

	public function testHandsOutThePublicKey(): void {
		$this->vapidKeys->method('getPublicKey')->willReturn('BPublicKey');
		$this->assertSame(['publicKey' => 'BPublicKey'], $this->controller()->key()->getData());
	}

	public function testMissingKeysMeanNotificationsAreNotSetUp(): void {
		$this->vapidKeys->method('getPublicKey')->willThrowException(new RuntimeException('keys missing'));
		$this->vapidKeys->expects($this->never())->method('create');
		$this->assertSame(Http::STATUS_SERVICE_UNAVAILABLE, $this->controller()->key()->getStatus());
	}

	public function testRefusesAnAddressThePolicyRejects(): void {
		$this->pushService->method('subscribe')->willReturn(PushService::REJECTED);
		$this->assertSame(Http::STATUS_BAD_REQUEST, $this->controller()->subscribe('https://10.0.0.1/', 'k', 'a')->getStatus());
	}

	public function testSubscribes(): void {
		$this->pushService->expects($this->once())->method('subscribe')
			->with('sam', 'https://fcm.googleapis.com/fcm/send/a', 'k', 'a', 55, 'Chrome on Android')
			->willReturn(PushService::SUBSCRIBED);
		$this->assertSame(Http::STATUS_OK, $this->controller()->subscribe('https://fcm.googleapis.com/fcm/send/a', 'k', 'a')->getStatus());
	}

	public function testAnotherUsersAddressIsAConflict(): void {
		$this->pushService->method('subscribe')->willReturn(PushService::CONFLICT);
		$this->assertSame(Http::STATUS_CONFLICT, $this->controller()->subscribe('https://fcm.googleapis.com/fcm/send/a', 'k', 'a')->getStatus());
	}

	public function testChecksTheAddressForTheSignedInUserAndSignIn(): void {
		$this->pushService->expects($this->once())->method('isSubscribed')
			->with('sam', 'https://fcm.googleapis.com/fcm/send/a', 55)->willReturn(false);
		$this->assertSame(['subscribed' => false], $this->controller()->check('https://fcm.googleapis.com/fcm/send/a')->getData());
	}

	public function testSavesTheDetailsPreference(): void {
		$this->preferences->expects($this->once())->method('setShowDetails')->with('sam', true);
		$this->assertSame(['showDetails' => true], $this->controller()->preferences(true)->getData());
	}

	public function testTestNotificationOpensThePhonePageByFragment(): void {
		$this->pushService->expects($this->once())->method('pushToUser')
			->with('sam', $this->callback(fn (array $payloads) => $payloads[0]['url'] === '#/' && !isset($payloads[0]['icon'])))
			->willReturn(1);
		$this->controller()->test();
	}

	public function testUnsubscribesOnlyForTheSignedInUser(): void {
		$this->pushService->expects($this->once())->method('unsubscribe')->with('sam', 'https://fcm.googleapis.com/fcm/send/a');
		$this->controller()->unsubscribe('https://fcm.googleapis.com/fcm/send/a');
	}

	public function testTestReportsHowManyWereDelivered(): void {
		$this->pushService->method('pushToUser')->willReturn(2);
		$this->assertSame(['delivered' => 2], $this->controller()->test()->getData());
	}

	public function testNeedsASignedInUser(): void {
		$this->assertSame(Http::STATUS_UNAUTHORIZED, $this->controller(null)->test()->getStatus());
	}
}
