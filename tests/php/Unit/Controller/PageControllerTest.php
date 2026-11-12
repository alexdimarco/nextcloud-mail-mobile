<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Tests\Unit\Controller;

use OC_Util;
use OCA\MailMobile\Controller\PageController;
use OCA\MailMobile\Mail\MailBridge;
use OCA\MailMobile\Mail\MailStatus;
use OCP\App\IAppManager;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

class PageControllerTest extends TestCase {
	private MailBridge&MockObject $bridge;
	private IInitialState&MockObject $initialState;
	private string $jsDir;
	/** @var array<string, mixed> */
	private array $state = [];

	protected function setUp(): void {
		OC_Util::$headers = [];
		$this->bridge = $this->createMock(MailBridge::class);
		$this->initialState = $this->createMock(IInitialState::class);
		$this->initialState->method('provideInitialState')->willReturnCallback(function (string $key, $value): void {
			$this->state[$key] = $value;
		});
		$this->jsDir = sys_get_temp_dir() . '/mail_mobile_test_' . bin2hex(random_bytes(4));
		mkdir($this->jsDir);
	}

	protected function tearDown(): void {
		foreach (glob($this->jsDir . '/*') ?: [] as $file) {
			unlink($file);
		}
		rmdir($this->jsDir);
	}

	private function controller(string $base = '/index.php/apps/mail_mobile/'): PageController {
		$appManager = $this->createMock(IAppManager::class);
		$appManager->method('getAppVersion')->with('mail_mobile')->willReturn('0.1.0');
		$urls = $this->createMock(IURLGenerator::class);
		$urls->method('linkToRoute')->willReturnCallback(fn (string $route) => match ($route) {
			'mail_mobile.page.index' => $base,
			'mail_mobile.page.manifest' => $base . 'manifest.webmanifest',
			'mail_mobile.page.serviceWorker' => $base . 'sw.js',
		});
		$urls->method('imagePath')->willReturnCallback(fn (string $app, string $file) => '/apps/' . $app . '/img/' . $file);
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnCallback(fn (string $text, array $params = []) => vsprintf($text, $params));

		return new PageController(
			$this->createMock(IRequest::class),
			'sam',
			$this->bridge,
			$appManager,
			$this->initialState,
			$urls,
			$l,
			$this->jsDir,
		);
	}

	public function testExplainsPlainlyWhenMailIsMissingOrUnsupported(): void {
		$this->bridge->method('status')->willReturn(MailStatus::unusable('5.10.11', 'Mail 5.10.11'));

		$response = $this->controller()->index();

		$this->assertSame(TemplateResponse::RENDER_AS_BASE, $response->getRenderAs());
		$this->assertSame(
			'Mail Mobile needs the Mail app, version 5.13 or newer and older than 7. This server has: Mail 5.10.11.',
			$response->getParams()['needsMail'],
		);
		$this->assertNull($response->getParams()['script']);
		$this->assertSame([], $this->state);
	}

	public function testServesTheCurrentHashedBundle(): void {
		$this->bridge->method('status')->willReturn(MailStatus::usable('5.13.2'));
		file_put_contents($this->jsDir . '/mobile-manifest.json', json_encode(['main' => 'mail_mobile-main.0123456789ab.js']));

		$response = $this->controller()->index();

		$this->assertSame('main', $response->getTemplateName());
		$this->assertSame('mail_mobile-main.0123456789ab', $response->getParams()['script']);
		$this->assertNull($response->getParams()['needsMail']);
		$this->assertSame('0.1.0', $this->state['version']);
		$this->assertSame('5.13.2', $this->state['mail-version']);
		$this->assertSame('/index.php/apps/mail_mobile/sw.js', $this->state['sw-url']);
		$this->assertSame('/index.php/apps/mail_mobile/', $this->state['sw-scope']);

		$csp = $response->getContentSecurityPolicy()->buildPolicy();
		$this->assertStringContainsString("frame-src 'self'", $csp);
		$this->assertStringContainsString("worker-src 'self'", $csp);

		$links = array_filter(OC_Util::$headers, fn (array $h) => $h['tag'] === 'link' && $h['attributes']['rel'] === 'manifest');
		$this->assertSame('/index.php/apps/mail_mobile/manifest.webmanifest', array_values($links)[0]['attributes']['href']);
	}

	public function testFallsBackToTheFixedBundleName(): void {
		$this->assertSame('mail_mobile-main', $this->controller()->mainScript());
		file_put_contents($this->jsDir . '/mobile-manifest.json', 'not json');
		$this->assertSame('mail_mobile-main', $this->controller()->mainScript());
	}

	public function testManifestUsesTheServersOwnAddresses(): void {
		$data = $this->controller('/apps/mail_mobile/')->manifest()->getData();

		$this->assertSame('/apps/mail_mobile/', $data['scope']);
		$this->assertSame('/apps/mail_mobile/', $data['start_url']);
		$this->assertSame('standalone', $data['display']);
		$sizes = array_column($data['icons'], 'sizes');
		$this->assertContains('192x192', $sizes);
		$this->assertContains('512x512', $sizes);
	}

	public function testServiceWorkerMayControlThePhonePage(): void {
		file_put_contents($this->jsDir . '/mail_mobile-sw.js', '/* sw */');

		$response = $this->controller()->serviceWorker();

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame('/* sw */', $response->render());
		// Read the headers set by the controller itself; getHeaders() would
		// also ask the Nextcloud server for its defaults
		$headers = (new \ReflectionProperty(\OCP\AppFramework\Http\Response::class, 'headers'))->getValue($response);
		$this->assertSame('/index.php/apps/mail_mobile/', $headers['Service-Worker-Allowed']);
		$this->assertStringStartsWith('application/javascript', $headers['Content-Type']);
	}

	public function testServiceWorkerMissingBeforeTheBuild(): void {
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->serviceWorker()->getStatus());
	}
}
