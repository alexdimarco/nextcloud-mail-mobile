<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Tests\Unit\Listener;

use OCA\MailMobile\Db\PushSubscriptionMapper;
use OCA\MailMobile\Listener\MailPageScriptListener;
use OCA\MailMobile\Listener\UserDeletedListener;
use OCP\EventDispatcher\Event;
use OCP\IUser;
use OCP\User\Events\UserDeletedEvent;
use PHPUnit\Framework\TestCase;

class OtherListenersTest extends TestCase {
	public function testDeletedUsersLoseTheirSubscriptions(): void {
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('sam');
		$mapper = $this->createMock(PushSubscriptionMapper::class);
		$mapper->expects($this->once())->method('deleteByUserId')->with('sam');

		(new UserDeletedListener($mapper))->handle(new UserDeletedEvent($user));
	}

	public function testUserDeletedListenerIgnoresOtherEvents(): void {
		$mapper = $this->createMock(PushSubscriptionMapper::class);
		$mapper->expects($this->never())->method('deleteByUserId');

		(new UserDeletedListener($mapper))->handle(new Event());
	}

	public function testReloginScriptOnlyOnMailsMainPage(): void {
		$this->assertTrue(MailPageScriptListener::isMailMainPage('mail', 'index'));
		$this->assertFalse(MailPageScriptListener::isMailMainPage('mail', 'settings'));
		$this->assertFalse(MailPageScriptListener::isMailMainPage('files', 'index'));
		$this->assertFalse(MailPageScriptListener::isMailMainPage('mail_mobile', 'main'));
	}
}
