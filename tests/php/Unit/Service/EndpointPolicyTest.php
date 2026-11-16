<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Tests\Unit\Service;

use OCA\MailMobile\Service\EndpointPolicy;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class EndpointPolicyTest extends TestCase {
	public static function allowed(): array {
		return [
			'Chrome and Android' => ['https://fcm.googleapis.com/fcm/send/abc:def'],
			'older Android' => ['https://android.googleapis.com/gcm/send/abc'],
			'Firefox' => ['https://updates.push.services.mozilla.com/wpush/v2/gAAAA'],
			'Safari and iPhone' => ['https://web.push.apple.com/QK4abc'],
			'Apple subdomain' => ['https://api.push.apple.com/3/device/abc'],
			'Windows' => ['https://db5p.notify.windows.com/w/?token=abc'],
			'upper-case host' => ['https://FCM.googleapis.com/fcm/send/abc'],
			'explicit https port' => ['https://fcm.googleapis.com:443/fcm/send/abc'],
		];
	}

	public static function denied(): array {
		return [
			'empty' => [''],
			'plain http' => ['http://fcm.googleapis.com/fcm/send/abc'],
			'internal address' => ['https://169.254.169.254/latest/meta-data'],
			'localhost' => ['https://localhost/push'],
			'look-alike suffix' => ['https://fcm.googleapis.com.evil.example/x'],
			'look-alike prefix' => ['https://evilfcm.googleapis.com/x'],
			'suffix without dot' => ['https://evilpush.apple.com/x'],
			'user and password' => ['https://user:pass@fcm.googleapis.com/fcm/send/abc'],
			'other port' => ['https://fcm.googleapis.com:8443/fcm/send/abc'],
			'not a URL' => ['fcm.googleapis.com'],
			'too long' => ['https://fcm.googleapis.com/' . str_repeat('a', 2048)],
		];
	}

	#[DataProvider('allowed')]
	public function testAllowsKnownPushServices(string $endpoint): void {
		$this->assertTrue(EndpointPolicy::isAllowed($endpoint));
	}

	#[DataProvider('denied')]
	public function testRejectsEverythingElse(string $endpoint): void {
		$this->assertFalse(EndpointPolicy::isAllowed($endpoint));
	}
}
