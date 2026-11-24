<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Tests\Unit\Mail;

use OCA\Mail\Account;
use OCA\Mail\Address;
use OCA\Mail\AddressList;
use OCA\Mail\Db\Mailbox;
use OCA\Mail\Db\Message;
use OCA\Mail\Db\Tag;
use OCA\Mail\Db\TagMapper;
use OCA\Mail\Events\NewMessagesSynchronized;
use OCA\Mail\Service\MailManager;
use OCA\MailMobile\Mail\MailBridge;
use OCP\App\IAppManager;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\EventDispatcher\Event;
use OCP\IL10N;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Psr\Log\NullLogger;
use RuntimeException;

class MailBridgeTest extends TestCase {
	private IAppManager&MockObject $appManager;
	private IUserManager&MockObject $userManager;
	private ContainerInterface&MockObject $container;
	private MailBridge $bridge;

	protected function setUp(): void {
		$this->appManager = $this->createMock(IAppManager::class);
		$this->userManager = $this->createMock(IUserManager::class);
		$this->container = $this->createMock(ContainerInterface::class);
		$this->bridge = new MailBridge($this->appManager, $this->userManager, $this->container, new NullLogger());
		$this->userManager->method('get')->willReturnCallback(fn (string $uid) => $uid === 'sam' ? $this->createMock(IUser::class) : null);
	}

	private function mailInstalled(string $version, bool $enabledForUser = true): void {
		$this->appManager->method('isInstalled')->with('mail')->willReturn(true);
		$this->appManager->method('getAppVersion')->with('mail')->willReturn($version);
		$this->appManager->method('isEnabledForUser')->willReturn($enabledForUser);
	}

	public static function versions(): array {
		return [
			['5.10.11', false],
			['5.12.9', false],
			['5.13.0-rc.1', true],
			['5.13.0', true],
			['5.13.2', true],
			['6.0.0-alpha.3', true],
			['6.4.1', true],
			['7.0.0', false],
			['7.0.0-beta.1', false],
			['', false],
		];
	}

	#[DataProvider('versions')]
	public function testVersionGate(string $version, bool $supported): void {
		$this->assertSame($supported, MailBridge::isSupportedVersion($version));
	}

	public function testUsableWithSupportedMail(): void {
		$this->mailInstalled('5.13.2');
		$status = $this->bridge->status('sam');
		$this->assertTrue($status->usable);
		$this->assertSame('5.13.2', $status->mailVersion);
	}

	public function testNotUsableWithoutMail(): void {
		$this->appManager->method('isInstalled')->willReturn(false);
		$status = $this->bridge->status('sam');
		$this->assertFalse($status->usable);
		$this->assertSame('Mail is not installed or not enabled', $status->found);
	}

	public function testNotUsableWithOldMail(): void {
		$this->mailInstalled('5.10.11');
		$status = $this->bridge->status('sam');
		$this->assertFalse($status->usable);
		$this->assertSame('Mail 5.10.11', $status->found);
	}

	public function testNotUsableWhenMailIsOffForTheUser(): void {
		$this->mailInstalled('5.13.2', false);
		$this->assertFalse($this->bridge->isUsable('sam'));
	}

	public function testNotUsableForUnknownUser(): void {
		$this->mailInstalled('5.13.2');
		$this->assertFalse($this->bridge->isUsable('nobody'));
	}

	private function event(bool $inbox, int $messages, bool $namedInbox = false): NewMessagesSynchronized {
		$account = $this->createMock(Account::class);
		$account->method('getUserId')->willReturn('sam');
		$account->method('getId')->willReturn(4);
		$mailbox = $this->createMock(Mailbox::class);
		$mailbox->method('getId')->willReturn(7);
		$mailbox->method('isSpecialUse')->willReturnCallback(fn (string $use) => $inbox && $use === 'inbox');
		$mailbox->method('isInbox')->willReturn($namedInbox);
		$list = [];
		for ($i = 1; $i <= $messages; $i++) {
			$message = $this->createMock(Message::class);
			$message->method('getId')->willReturn(100 + $i);
			$list[] = $message;
		}
		return new NewMessagesSynchronized($account, $mailbox, $list);
	}

	public function testReadsNewInboxMailAsIds(): void {
		$newMail = $this->bridge->readNewMessages($this->event(true, 2));
		$this->assertNotNull($newMail);
		$this->assertSame('sam', $newMail->userId);
		$this->assertSame(4, $newMail->accountId);
		$this->assertSame(7, $newMail->mailboxId);
		$this->assertSame([101, 102], $newMail->messageIds);
		$this->assertSame(2, $newMail->count);
	}

	public function testKeepsAtMostThreeIdsButTheFullCount(): void {
		$newMail = $this->bridge->readNewMessages($this->event(true, 5));
		$this->assertSame([101, 102, 103], $newMail?->messageIds);
		$this->assertSame(5, $newMail?->count);
	}

	public function testIgnoresOtherFolders(): void {
		$this->assertNull($this->bridge->readNewMessages($this->event(false, 2)));
	}

	public function testTreatsAMailboxNamedInboxAsTheInbox(): void {
		// Mail 6 does the same when the server sends no "inbox" mark
		$newMail = $this->bridge->readNewMessages($this->event(false, 1, true));
		$this->assertSame([101], $newMail?->messageIds);
	}

	public function testSaysPlainlyWhichMailVersionsWork(): void {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnCallback(fn (string $text, array $params = []) => vsprintf($text, $params));
		$this->assertSame(
			'Mail Mobile needs the Mail app, version 5.13 to 6.x. This server has: Mail 7.0.0.',
			MailBridge::needsMailMessage($l, 'Mail 7.0.0'),
		);
	}

	public function testIgnoresEmptyEvents(): void {
		$this->assertNull($this->bridge->readNewMessages($this->event(true, 0)));
	}

	public function testIgnoresOtherEvents(): void {
		$this->assertNull($this->bridge->readNewMessages(new Event()));
	}

	public function testDescribesAMessageThroughMail(): void {
		$address = $this->createMock(Address::class);
		$address->method('getLabel')->willReturn('Sam Carter');
		$address->method('getEmail')->willReturn('sam@example.com');
		$from = $this->createMock(AddressList::class);
		$from->method('first')->willReturn($address);
		$message = $this->createMock(Message::class);
		$message->method('getFrom')->willReturn($from);
		$message->method('getSubject')->willReturn('Lunch?');
		$manager = $this->createMock(MailManager::class);
		$manager->expects($this->once())->method('getMessage')->with('sam', 101)->willReturn($message);
		$this->container->method('get')->with(MailManager::class)->willReturn($manager);

		$this->assertSame(['from' => 'Sam Carter', 'email' => 'sam@example.com', 'subject' => 'Lunch?'], $this->bridge->describe('sam', 101));
	}

	public function testFallsBackToTheAddressWithoutAName(): void {
		$address = $this->createMock(Address::class);
		$address->method('getLabel')->willReturn(null);
		$address->method('getEmail')->willReturn('sam@example.com');
		$from = $this->createMock(AddressList::class);
		$from->method('first')->willReturn($address);
		$message = $this->createMock(Message::class);
		$message->method('getFrom')->willReturn($from);
		$manager = $this->createMock(MailManager::class);
		$manager->method('getMessage')->willReturn($message);
		$this->container->method('get')->willReturn($manager);

		$this->assertSame(['from' => 'sam@example.com', 'email' => 'sam@example.com', 'subject' => ''], $this->bridge->describe('sam', 101));
	}

	public function testDescribeReturnsNullWhenMailFails(): void {
		$this->container->method('get')->willThrowException(new RuntimeException('Mail changed'));
		$this->assertNull($this->bridge->describe('sam', 101));
	}

	public function testFindsThePersonsPinnedTag(): void {
		$tag = $this->createMock(Tag::class);
		$tag->method('getId')->willReturn(7);
		$tags = $this->createMock(TagMapper::class);
		$tags->expects($this->once())->method('getTagByImapLabel')->with('$pinned', 'sam')->willReturn($tag);
		$this->container->method('get')->with(TagMapper::class)->willReturn($tags);

		$this->assertSame(7, $this->bridge->pinnedTagId('sam'));
	}

	public function testNoPinnedTagBeforeTheFirstPin(): void {
		$tags = $this->createMock(TagMapper::class);
		$tags->method('getTagByImapLabel')->willThrowException(new DoesNotExistException('no tag'));
		$this->container->method('get')->willReturn($tags);

		$this->assertNull($this->bridge->pinnedTagId('sam'));
	}

	public function testPinnedTagIsNullWhenMailFails(): void {
		$this->container->method('get')->willThrowException(new RuntimeException('Mail changed'));
		$this->assertNull($this->bridge->pinnedTagId('sam'));
	}
}
