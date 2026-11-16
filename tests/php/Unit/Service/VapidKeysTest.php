<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Tests\Unit\Service;

use OCA\MailMobile\Service\VapidKeys;
use OCP\IAppConfig;
use OCP\Security\ICrypto;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use RuntimeException;

class VapidKeysTest extends TestCase {
	/** @var array<string, string> */
	private array $values = [];
	/** @var array<string, bool> */
	private array $sensitive = [];
	private bool $cryptoBroken = false;
	private VapidKeys $keys;

	protected function setUp(): void {
		$config = $this->createMock(IAppConfig::class);
		$config->method('getValueString')->willReturnCallback(
			fn (string $app, string $key, string $default = '') => $this->values[$app . '/' . $key] ?? $default,
		);
		$config->method('setValueString')->willReturnCallback(
			function (string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool {
				$this->values[$app . '/' . $key] = $value;
				$this->sensitive[$app . '/' . $key] = $sensitive;
				return true;
			},
		);
		$config->method('deleteKey')->willReturnCallback(function (string $app, string $key): void {
			unset($this->values[$app . '/' . $key], $this->sensitive[$app . '/' . $key]);
		});

		$crypto = $this->createMock(ICrypto::class);
		$crypto->method('encrypt')->willReturnCallback(fn (string $plain) => 'enc:' . base64_encode($plain));
		$crypto->method('decrypt')->willReturnCallback(function (string $cipher): string {
			if ($this->cryptoBroken || !str_starts_with($cipher, 'enc:')) {
				throw new RuntimeException('HMAC does not match');
			}
			return base64_decode(substr($cipher, 4));
		});

		$this->keys = new VapidKeys($config, $crypto, new NullLogger());
	}

	public function testNeverMakesKeysWhenRead(): void {
		$this->assertSame(VapidKeys::STATE_MISSING, $this->keys->state());

		$this->expectException(RuntimeException::class);
		try {
			$this->keys->getPublicKey();
		} finally {
			$this->assertSame([], $this->values, 'reading wrote nothing');
		}
	}

	public function testCreateMakesUsableKeys(): void {
		$this->keys->create();

		$this->assertSame(VapidKeys::STATE_OK, $this->keys->state());
		$pair = $this->keys->getKeyPair();
		$this->assertNotSame('', $pair['publicKey']);
		$this->assertSame($pair['publicKey'], $this->keys->getPublicKey());
	}

	public function testStoresThePrivateKeyEncryptedAndSensitive(): void {
		$this->keys->create();
		$pair = $this->keys->getKeyPair();
		$stored = $this->values['mail_mobile/vapid_private'];

		$this->assertStringStartsWith('enc:', $stored);
		$this->assertStringNotContainsString($pair['privateKey'], $stored);
		$this->assertTrue($this->sensitive['mail_mobile/vapid_private']);
		$this->assertFalse($this->sensitive['mail_mobile/vapid_public']);
	}

	public function testRefusesInsteadOfReplacingAnUnreadablePrivateKey(): void {
		$this->keys->create();
		$public = $this->values['mail_mobile/vapid_public'];
		$this->cryptoBroken = true;

		$this->assertSame(VapidKeys::STATE_UNREADABLE, $this->keys->state());
		try {
			$this->keys->getKeyPair();
			$this->fail('an unreadable key must not be used');
		} catch (RuntimeException) {
		}
		$this->assertSame($public, $this->values['mail_mobile/vapid_public'], 'the keys were not replaced');
	}

	public function testCreateReplacesTheKeys(): void {
		$this->keys->create();
		$first = $this->keys->getPublicKey();
		$this->keys->create();
		$this->assertNotSame($first, $this->keys->getPublicKey());
	}
}
