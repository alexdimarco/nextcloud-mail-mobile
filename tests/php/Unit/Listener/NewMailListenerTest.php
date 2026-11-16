<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Tests\Unit\Listener;

use OCA\MailMobile\BackgroundJob\PushJob;
use OCA\MailMobile\Listener\NewMailListener;
use OCA\MailMobile\Mail\MailBridge;
use OCA\MailMobile\Mail\NewMail;
use OCA\MailMobile\Service\PushService;
use OCP\BackgroundJob\IJobList;
use OCP\EventDispatcher\Event;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use RuntimeException;

class NewMailListenerTest extends TestCase {
	private MailBridge&MockObject $bridge;
	private PushService&MockObject $pushService;
	private IJobList&MockObject $jobList;
	private NewMailListener $listener;

	protected function setUp(): void {
		$this->bridge = $this->createMock(MailBridge::class);
		$this->pushService = $this->createMock(PushService::class);
		$this->jobList = $this->createMock(IJobList::class);
		$this->listener = new NewMailListener($this->bridge, $this->pushService, $this->jobList, new NullLogger());
	}

	public function testQueuesAJobWithIdsOnly(): void {
		$this->bridge->method('readNewMessages')->willReturn(new NewMail('sam', 4, 7, [101, 102], 2));
		$this->bridge->method('isUsable')->with('sam')->willReturn(true);
		$this->pushService->method('hasSubscriptions')->with('sam')->willReturn(true);
		$this->jobList->expects($this->once())->method('add')->with(PushJob::class, [
			'userId' => 'sam',
			'accountId' => 4,
			'mailboxId' => 7,
			'messageIds' => [101, 102],
			'count' => 2,
		]);

		$this->listener->handle(new Event());
	}

	public function testSkipsUsersWithoutSubscriptions(): void {
		$this->bridge->method('readNewMessages')->willReturn(new NewMail('sam', 4, 7, [101], 1));
		$this->bridge->method('isUsable')->willReturn(true);
		$this->pushService->method('hasSubscriptions')->willReturn(false);
		$this->jobList->expects($this->never())->method('add');

		$this->listener->handle(new Event());
	}

	public function testSkipsWhenMailIsNotUsable(): void {
		$this->bridge->method('readNewMessages')->willReturn(new NewMail('sam', 4, 7, [101], 1));
		$this->bridge->method('isUsable')->willReturn(false);
		$this->pushService->expects($this->never())->method('hasSubscriptions');
		$this->jobList->expects($this->never())->method('add');

		$this->listener->handle(new Event());
	}

	public function testIgnoresEventsThatAreNotNewInboxMail(): void {
		$this->bridge->method('readNewMessages')->willReturn(null);
		$this->jobList->expects($this->never())->method('add');

		$this->listener->handle(new Event());
	}

	public function testNeverBreaksMailsSync(): void {
		$this->bridge->method('readNewMessages')->willReturn(new NewMail('sam', 4, 7, [101], 1));
		$this->bridge->method('isUsable')->willReturn(true);
		$this->pushService->method('hasSubscriptions')->willThrowException(new RuntimeException('database down'));

		$this->listener->handle(new Event());
		$this->addToAssertionCount(1);
	}
}
