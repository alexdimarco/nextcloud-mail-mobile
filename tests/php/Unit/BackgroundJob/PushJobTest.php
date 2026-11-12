<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Tests\Unit\BackgroundJob;

use OCA\MailMobile\BackgroundJob\PushJob;
use OCA\MailMobile\Mail\MailBridge;
use OCA\MailMobile\Service\Preferences;
use OCA\MailMobile\Service\PushService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IL10N;
use OCP\IUser;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

class PushJobTest extends TestCase {
	private MailBridge&MockObject $bridge;
	private PushService&MockObject $pushService;
	private bool $showDetails = true;
	private PushJob $job;

	protected function setUp(): void {
		$this->bridge = $this->createMock(MailBridge::class);
		$this->bridge->method('isUsable')->willReturn(true);
		$this->pushService = $this->createMock(PushService::class);
		$this->job = $this->job($this->bridge);
	}

	private function job(MailBridge $bridge): PushJob {
		$preferences = $this->createMock(Preferences::class);
		$preferences->method('showDetails')->willReturnCallback(fn () => $this->showDetails);

		$users = $this->createMock(IUserManager::class);
		$users->method('get')->willReturn($this->createMock(IUser::class));

		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		$l->method('n')->willReturnCallback(fn (string $one, string $many, int $count) => str_replace('%n', (string)$count, $count === 1 ? $one : $many));
		$l10n = $this->createMock(IFactory::class);
		$l10n->method('get')->willReturn($l);
		$l10n->method('getUserLanguage')->willReturn('en');

		return new PushJob(
			$this->createMock(ITimeFactory::class),
			$this->pushService,
			$bridge,
			$preferences,
			$users,
			$l10n,
			new NullLogger(),
		);
	}

	public function testOneNotificationPerMessageWithSenderAndSubject(): void {
		$this->bridge->method('describe')->willReturnMap([
			['sam', 101, ['from' => 'Alice', 'email' => 'alice@example.com', 'subject' => 'Lunch?']],
			['sam', 102, null],
		]);

		$result = $this->job->buildPayloads([
			'userId' => 'sam', 'accountId' => 4, 'mailboxId' => 7, 'messageIds' => [101, 102], 'count' => 2,
		]);

		$this->assertSame('sam', $result['userId']);
		$this->assertCount(2, $result['payloads']);
		// The real address next to the name, which any sender can choose
		$this->assertSame('Alice <alice@example.com>', $result['payloads'][0]['title']);
		$this->assertSame('Lunch?', $result['payloads'][0]['body']);
		// Only the part after "#": cron may not know the server's address
		$this->assertSame('#/msg/7/101', $result['payloads'][0]['url']);
		$this->assertSame('message-101', $result['payloads'][0]['tag']);
		$this->assertArrayNotHasKey('icon', $result['payloads'][0]);
		// A message Mail cannot describe still gets a plain notification
		$this->assertSame('New message', $result['payloads'][1]['title']);
		$this->assertSame('', $result['payloads'][1]['body']);
	}

	public function testHidesSenderAndSubjectUnlessChosen(): void {
		$this->showDetails = false;
		$this->bridge->expects($this->never())->method('describe');

		$result = $this->job->buildPayloads([
			'userId' => 'sam', 'accountId' => 4, 'mailboxId' => 7, 'messageIds' => [101], 'count' => 1,
		]);

		$this->assertCount(1, $result['payloads']);
		$this->assertSame('New mail', $result['payloads'][0]['title']);
		$this->assertSame('1 new message', $result['payloads'][0]['body']);
		$this->assertSame('#/msg/7/101', $result['payloads'][0]['url']);
	}

	public function testShowsTheAddressAloneWithoutAName(): void {
		$this->bridge->method('describe')->willReturn(['from' => 'bob@example.com', 'email' => 'bob@example.com', 'subject' => 'Hi']);

		$result = $this->job->buildPayloads([
			'userId' => 'sam', 'accountId' => 4, 'mailboxId' => 7, 'messageIds' => [101], 'count' => 1,
		]);

		$this->assertSame('bob@example.com', $result['payloads'][0]['title']);
	}

	public function testOneSummaryForManyMessages(): void {
		$this->bridge->expects($this->never())->method('describe');

		$result = $this->job->buildPayloads([
			'userId' => 'sam', 'accountId' => 4, 'mailboxId' => 7, 'messageIds' => [101, 102, 103], 'count' => 9,
		]);

		$this->assertCount(1, $result['payloads']);
		$this->assertSame('New mail', $result['payloads'][0]['title']);
		$this->assertSame('9 new messages', $result['payloads'][0]['body']);
		$this->assertSame('#/box/7', $result['payloads'][0]['url']);
	}

	public function testShortensLongSubjects(): void {
		$this->bridge->method('describe')->willReturn(['from' => 'Alice', 'email' => 'alice@example.com', 'subject' => str_repeat('é', 500)]);

		$result = $this->job->buildPayloads([
			'userId' => 'sam', 'accountId' => 4, 'mailboxId' => 7, 'messageIds' => [101], 'count' => 1,
		]);

		$this->assertSame(PushJob::MAX_TEXT, mb_strlen($result['payloads'][0]['body']));
	}

	public function testRejectsABrokenArgument(): void {
		$this->assertNull($this->job->buildPayloads(['userId' => 'sam']));
		$this->assertNull($this->job->buildPayloads('sam'));
	}

	public function testDoesNothingWhenMailIsNoLongerUsable(): void {
		$bridge = $this->createMock(MailBridge::class);
		$bridge->method('isUsable')->willReturn(false);
		$this->assertNull($this->job($bridge)->buildPayloads([
			'userId' => 'sam', 'accountId' => 4, 'mailboxId' => 7, 'messageIds' => [101], 'count' => 1,
		]));
	}
}
