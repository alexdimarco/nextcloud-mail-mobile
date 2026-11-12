<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Tests\Unit\Controller;

use OCA\MailMobile\Controller\PushController;
use OCA\MailMobile\Service\PushService;
use OCA\MailMobile\Service\VapidKeys;
use OCP\AppFramework\Http;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use RuntimeException;

class PushControllerTest extends TestCase {
	private PushService&MockObject $pushService;
	private VapidKeys&MockObject $vapidKeys;

	protected function setUp(): void {
		$this->pushService = $this->createMock(PushService::class);
		$this->vapidKeys = $this->createMock(VapidKeys::class);
	}

	private function controller(?string $userId = 'sam'): PushController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new PushController(
			$this->createMock(IRequest::class),
			$userId,
			$this->pushService,
			$this->vapidKeys,
			$this->createMock(IURLGenerator::class),
			$l,
			new NullLogger(),
		);
	}

	public function testHandsOutThePublicKey(): void {
		$this->vapidKeys->method('getPublicKey')->willReturn('BPublicKey');
		$this->assertSame(['publicKey' => 'BPublicKey'], $this->controller()->key()->getData());
	}

	public function testKeyErrorIsAServerError(): void {
		$this->vapidKeys->method('getPublicKey')->willThrowException(new RuntimeException('no openssl'));
		$this->assertSame(Http::STATUS_INTERNAL_SERVER_ERROR, $this->controller()->key()->getStatus());
	}

	public function testRefusesAnAddressThePolicyRejects(): void {
		$this->pushService->method('subscribe')->willReturn(false);
		$this->assertSame(Http::STATUS_BAD_REQUEST, $this->controller()->subscribe('https://10.0.0.1/', 'k', 'a')->getStatus());
	}

	public function testSubscribes(): void {
		$this->pushService->expects($this->once())->method('subscribe')
			->with('sam', 'https://fcm.googleapis.com/fcm/send/a', 'k', 'a')->willReturn(true);
		$this->assertSame(Http::STATUS_OK, $this->controller()->subscribe('https://fcm.googleapis.com/fcm/send/a', 'k', 'a')->getStatus());
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
