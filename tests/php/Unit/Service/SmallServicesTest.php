<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Tests\Unit\Service;

use OCA\MailMobile\Service\DeviceName;
use OCA\MailMobile\Service\PushSubject;
use OCA\MailMobile\Service\SessionToken;
use OCA\MailMobile\Service\SourceLink;
use OCP\App\IAppManager;
use OCP\Authentication\Exceptions\InvalidTokenException;
use OCP\Authentication\Token\IProvider;
use OCP\Authentication\Token\IToken;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\ISession;
use OCP\Session\Exceptions\SessionNotAvailableException;
use PHPUnit\Framework\TestCase;

class SmallServicesTest extends TestCase {
	public function testNamesCommonPhoneBrowsers(): void {
		$this->assertSame('Chrome on Android', DeviceName::fromUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'));
		$this->assertSame('Safari on iPhone', DeviceName::fromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'));
		$this->assertSame('Firefox on Android', DeviceName::fromUserAgent('Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0'));
		$this->assertSame('Samsung Internet on Android', DeviceName::fromUserAgent('Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36'));
		$this->assertSame('Edge on Windows', DeviceName::fromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0'));
		$this->assertSame('Unknown browser', DeviceName::fromUserAgent(''));
	}

	/**
	 * @return array<string, array{string, bool}>
	 */
	public static function subjects(): array {
		return [
			'mailto' => ['mailto:admin@example.com', true],
			'https' => ['https://cloud.example', true],
			'http' => ['http://localhost/', false],
			'bad mailto' => ['mailto:nobody', false],
			'empty' => ['', false],
			'other scheme' => ['javascript:alert(1)', false],
		];
	}

	#[\PHPUnit\Framework\Attributes\DataProvider('subjects')]
	public function testAcceptsOnlyMailtoOrHttpsContactAddresses(string $subject, bool $valid): void {
		$this->assertSame($valid, PushSubject::isValid($subject));
	}

	private function subject(string $configured, string $cliUrl): PushSubject {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')->willReturn($configured);
		$config = $this->createMock(IConfig::class);
		$config->method('getSystemValueString')->willReturn($cliUrl);
		return new PushSubject($appConfig, $config);
	}

	public function testPrefersTheAdminsContactAddress(): void {
		$this->assertSame('mailto:admin@example.com', $this->subject('mailto:admin@example.com', 'https://cloud.example')->get());
	}

	public function testFallsBackToAnHttpsServerAddressOnly(): void {
		$this->assertSame('https://cloud.example', $this->subject('', 'https://cloud.example')->get());
		$this->assertNull($this->subject('', 'http://localhost')->get());
		$this->assertNull($this->subject('', '')->get());
	}

	public function testFindsTheBrowserSessionsSignIn(): void {
		$session = $this->createMock(ISession::class);
		$session->method('getId')->willReturn('session-id');
		$token = $this->createMock(IToken::class);
		$token->method('getId')->willReturn(55);
		$provider = $this->createMock(IProvider::class);
		$provider->method('getToken')->with('session-id')->willReturn($token);

		$this->assertSame(55, (new SessionToken($session, $provider))->currentId());
	}

	public function testFindsAnAppPasswordWhenThereIsNoSessionSignIn(): void {
		$session = $this->createMock(ISession::class);
		$session->method('getId')->willThrowException(new SessionNotAvailableException());
		$session->method('get')->with('app_password')->willReturn('app-password');
		$token = $this->createMock(IToken::class);
		$token->method('getId')->willReturn(77);
		$provider = $this->createMock(IProvider::class);
		$provider->method('getToken')->with('app-password')->willReturn($token);

		$this->assertSame(77, (new SessionToken($session, $provider))->currentId());
	}

	public function testNoSignInFound(): void {
		$session = $this->createMock(ISession::class);
		$session->method('getId')->willReturn('session-id');
		$provider = $this->createMock(IProvider::class);
		$provider->method('getToken')->willThrowException(new InvalidTokenException());

		$this->assertNull((new SessionToken($session, $provider))->currentId());
	}

	private function sourceLink(mixed $repository): SourceLink {
		$apps = $this->createMock(IAppManager::class);
		$apps->method('getAppInfo')->willReturn(['repository' => $repository]);
		return new SourceLink($apps);
	}

	public function testLinksToTheSourceOnlyOnceTheAddressIsReal(): void {
		$this->assertSame('https://github.com/someone/nextcloud-mail-mobile', $this->sourceLink('https://github.com/someone/nextcloud-mail-mobile')->url());
		$this->assertSame('https://github.com/someone/x', $this->sourceLink(['@value' => 'https://github.com/someone/x'])->url());
		$this->assertSame('', $this->sourceLink('https://github.com/OWNER/nextcloud-mail-mobile')->url());
		$this->assertSame('', $this->sourceLink('javascript:alert(1)')->url());
		$this->assertSame('', $this->sourceLink(null)->url());
	}
}
