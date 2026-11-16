<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Controller;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Mail\MailBridge;
use OCA\MailMobile\Service\Preferences;
use OCA\MailMobile\Service\SourceLink;
use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\StandaloneTemplateResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\Util;
use function basename;
use function file_get_contents;
use function is_array;
use function is_file;
use function is_string;
use function json_decode;

/**
 * Serves the phone page, its home-screen manifest and its service worker.
 */
class PageController extends Controller {
	public const THEME_COLOR = '#2f6fed';

	/** Where the front-end build puts its files */
	private string $jsDir;

	public function __construct(
		IRequest $request,
		private ?string $userId,
		private MailBridge $bridge,
		private IAppManager $appManager,
		private IInitialState $initialState,
		private IURLGenerator $urlGenerator,
		private IL10N $l,
		private Preferences $preferences,
		private SourceLink $sourceLink,
		?string $jsDir = null,
	) {
		parent::__construct(Application::APP_ID, $request);
		$this->jsDir = $jsDir ?? __DIR__ . '/../../js';
	}

	/**
	 * The phone page.
	 *
	 * Rendered as a bare page on purpose: the normal Nextcloud layout
	 * links the theming app's web manifest, which would make "Add to Home
	 * Screen" install the full desktop site instead of this page. The bare
	 * page still carries the sign-in check and the anti-forgery token.
	 *
	 * It is a standalone response so that other apps do not add their own
	 * scripts to it. Without this, the first-run wizard's welcome dialog
	 * covered the whole phone screen on a person's first sign-in, and other
	 * apps' desktop scripts were downloaded for nothing.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): StandaloneTemplateResponse {
		$this->addHomeScreenHeaders();
		$status = $this->bridge->status($this->userId);

		if (!$status->usable) {
			return new StandaloneTemplateResponse(Application::APP_ID, 'main', [
				'needsMail' => MailBridge::needsMailMessage($this->l, $status->found),
				'script' => null,
				'version' => $this->appVersion(),
			], TemplateResponse::RENDER_AS_BASE);
		}

		$this->initialState->provideInitialState('version', $this->appVersion());
		$this->initialState->provideInitialState('mail-version', (string)$status->mailVersion);
		$this->initialState->provideInitialState('sw-url', $this->urlGenerator->linkToRoute('mail_mobile.page.serviceWorker'));
		$this->initialState->provideInitialState('sw-scope', $this->scope());
		// Worked out here, in a web request, where the server's address is
		// known; notifications sent from cron carry no icon address
		$this->initialState->provideInitialState('icon-url', $this->urlGenerator->imagePath(Application::APP_ID, 'icon-192.png'));
		$this->initialState->provideInitialState('show-details', $this->userId !== null && $this->preferences->showDetails($this->userId));
		$this->initialState->provideInitialState('source-url', $this->sourceLink->url());

		$response = new StandaloneTemplateResponse(Application::APP_ID, 'main', [
			'needsMail' => null,
			'script' => $this->mainScript(),
			'version' => $this->appVersion(),
		], TemplateResponse::RENDER_AS_BASE);

		// Message bodies are shown in a frame from this same server
		// (Mail's /api/messages/{id}/html), sandboxed without scripts in
		// src/views/Reader.vue. Notifications need a service worker from
		// this same server. Nothing else is allowed.
		$csp = new ContentSecurityPolicy();
		$csp->addAllowedFrameDomain('\'self\'');
		$csp->addAllowedWorkerSrcDomain('\'self\'');
		$response->setContentSecurityPolicy($csp);

		return $response;
	}

	/**
	 * The home-screen ("web app") manifest. Public because browsers fetch
	 * it without cookies; it holds no user data.
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	public function manifest(): JSONResponse {
		$scope = $this->scope();
		$response = new JSONResponse([
			'id' => $scope,
			'name' => 'Mail Mobile',
			// Not just "Mail": that is also the name of the iPhone's own app
			'short_name' => 'Mail Mobile',
			'start_url' => $scope,
			'scope' => $scope,
			'display' => 'standalone',
			'background_color' => '#ffffff',
			'theme_color' => self::THEME_COLOR,
			'icons' => [
				[
					'src' => $this->urlGenerator->imagePath(Application::APP_ID, 'icon-192.png'),
					'sizes' => '192x192',
					'type' => 'image/png',
				],
				[
					'src' => $this->urlGenerator->imagePath(Application::APP_ID, 'icon-512.png'),
					'sizes' => '512x512',
					'type' => 'image/png',
				],
				[
					'src' => $this->urlGenerator->imagePath(Application::APP_ID, 'icon-512.png'),
					'sizes' => '512x512',
					'type' => 'image/png',
					'purpose' => 'maskable',
				],
			],
		]);
		$response->addHeader('Content-Type', 'application/manifest+json; charset=utf-8');
		return $response;
	}

	/**
	 * The service worker that shows notifications. Public for the same
	 * reason as the manifest; it is a static script with no user data.
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	public function serviceWorker(): DataDisplayResponse {
		$file = $this->jsDir . '/mail_mobile-sw.js';
		$js = is_file($file) ? file_get_contents($file) : false;
		if ($js === false) {
			return new DataDisplayResponse('', Http::STATUS_NOT_FOUND);
		}
		return new DataDisplayResponse($js, Http::STATUS_OK, [
			'Content-Type' => 'application/javascript; charset=utf-8',
			'Service-Worker-Allowed' => $this->scope(),
			'Cache-Control' => 'no-cache',
		]);
	}

	/**
	 * The address the phone page lives at. Worked out by Nextcloud, so it
	 * includes /index.php/ on servers whose addresses need it.
	 */
	private function scope(): string {
		return $this->urlGenerator->linkToRoute('mail_mobile.page.index');
	}

	private function appVersion(): string {
		return $this->appManager->getAppVersion(Application::APP_ID);
	}

	/**
	 * The name of the current main bundle. Its file name carries a hash of
	 * its content, so every build gets a new address and no cache (browser,
	 * home-screen app, or a proxy) can keep serving an old copy.
	 */
	public function mainScript(): string {
		$fallback = 'mail_mobile-main';
		$manifestFile = $this->jsDir . '/mobile-manifest.json';
		if (!is_file($manifestFile)) {
			return $fallback;
		}
		$manifest = json_decode((string)file_get_contents($manifestFile), true);
		if (!is_array($manifest) || !is_string($manifest['main'] ?? null)) {
			return $fallback;
		}
		return basename($manifest['main'], '.js');
	}

	private function addHomeScreenHeaders(): void {
		Util::addHeader('link', [
			'rel' => 'manifest',
			'href' => $this->urlGenerator->linkToRoute('mail_mobile.page.manifest'),
		]);
		Util::addHeader('link', [
			'rel' => 'apple-touch-icon',
			// The explicit size makes Safari prefer this icon over the
			// unsized favicon the base layout adds
			'sizes' => '180x180',
			'href' => $this->urlGenerator->imagePath(Application::APP_ID, 'touch-icon.png'),
		]);
		Util::addHeader('meta', ['name' => 'apple-mobile-web-app-capable', 'content' => 'yes']);
		Util::addHeader('meta', ['name' => 'mobile-web-app-capable', 'content' => 'yes']);
		Util::addHeader('meta', ['name' => 'apple-mobile-web-app-status-bar-style', 'content' => 'default']);
		Util::addHeader('meta', ['name' => 'apple-mobile-web-app-title', 'content' => 'Mail Mobile']);
		Util::addHeader('meta', ['name' => 'theme-color', 'content' => self::THEME_COLOR]);
	}
}
