<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Tests\Unit\Listener;

use OCA\MailMobile\Db\PushSubscriptionMapper;
use OCA\MailMobile\Listener\MailPageScriptListener;
use OCA\MailMobile\Listener\SignInEndedListener;
use OCA\MailMobile\Listener\UserDeletedListener;
use OCA\MailMobile\Service\PushService;
use OCP\Authentication\Events\TokenInvalidatedEvent;
use OCP\Authentication\Token\IToken;
use OCP\EventDispatcher\Event;
use OCP\IUser;
use OCP\User\Events\PasswordUpdatedEvent;
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

	public function testSigningOutOrRevokingADeviceStopsItsNotifications(): void {
		$token = $this->createMock(IToken::class);
		$token->method('getId')->willReturn(55);
		$push = $this->createMock(PushService::class);
		$push->expects($this->once())->method('removeForToken')->with(55);
		$push->expects($this->never())->method('removeAllForUser');

		(new SignInEndedListener($push))->handle(new TokenInvalidatedEvent($token));
	}

	public function testAPasswordChangeStopsAllNotifications(): void {
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('sam');
		$push = $this->createMock(PushService::class);
		$push->expects($this->once())->method('removeAllForUser')->with('sam');

		(new SignInEndedListener($push))->handle(new PasswordUpdatedEvent($user, 'new password'));
	}
}
