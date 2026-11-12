<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\BackgroundJob;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Mail\MailBridge;
use OCA\MailMobile\Service\PushService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use Psr\Log\LoggerInterface;
use Throwable;
use function is_array;
use function is_int;
use function is_string;
use function mb_substr;

/**
 * Sends the notifications for one batch of new mail. Runs once, on the
 * next cron run after Mail's sync found the mail.
 */
class PushJob extends QueuedJob {
	/** Longest subject shown in a notification, in characters */
	public const MAX_TEXT = 200;

	public function __construct(
		ITimeFactory $time,
		private PushService $pushService,
		private MailBridge $bridge,
		private IURLGenerator $urlGenerator,
		private IUserManager $userManager,
		private IFactory $l10nFactory,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
	}

	/**
	 * @param mixed $argument
	 */
	#[\Override]
	protected function run($argument): void {
		$payloads = $this->buildPayloads($argument);
		if ($payloads === null) {
			return;
		}
		try {
			$this->pushService->pushToUser($payloads['userId'], $payloads['payloads']);
		} catch (Throwable $e) {
			// A failed notification must not make the job retry forever
			$this->logger->warning('Mail notification delivery failed: ' . $e->getMessage(), ['exception' => $e]);
		}
	}

	/**
	 * @param mixed $argument
	 * @return ?array{userId: string, payloads: list<array{title: string, body: string, url: string, tag: string, icon: string}>}
	 */
	public function buildPayloads($argument): ?array {
		if (!is_array($argument)
			|| !is_string($argument['userId'] ?? null)
			|| !is_int($argument['mailboxId'] ?? null)
			|| !is_array($argument['messageIds'] ?? null)
			|| !is_int($argument['count'] ?? null)) {
			$this->logger->warning('Skipping a mail notification job with an invalid argument');
			return null;
		}
		$userId = $argument['userId'];
		$mailboxId = $argument['mailboxId'];
		$count = $argument['count'];
		if (!$this->bridge->isUsable($userId)) {
			return null;
		}

		$user = $this->userManager->get($userId);
		$l = $this->l10nFactory->get(Application::APP_ID, $user !== null ? $this->l10nFactory->getUserLanguage($user) : null);
		$base = $this->urlGenerator->linkToRouteAbsolute('mail_mobile.page.index');
		$icon = $this->urlGenerator->getAbsoluteURL($this->urlGenerator->imagePath(Application::APP_ID, 'icon-192.png'));

		$messageIds = array_values(array_filter($argument['messageIds'], 'is_int'));
		if ($count > MailBridge::MAX_MESSAGES || $messageIds === []) {
			return ['userId' => $userId, 'payloads' => [[
				'title' => $l->t('New mail'),
				'body' => $l->n('%n new message', '%n new messages', max(1, $count)),
				'url' => $base . '#/box/' . $mailboxId,
				'tag' => 'mailbox-' . $mailboxId,
				'icon' => $icon,
			]]];
		}

		$payloads = [];
		foreach ($messageIds as $messageId) {
			$details = $this->bridge->describe($userId, $messageId);
			$payloads[] = [
				'title' => ($details !== null && $details['from'] !== '') ? mb_substr($details['from'], 0, self::MAX_TEXT) : $l->t('New message'),
				'body' => $details !== null ? mb_substr($details['subject'], 0, self::MAX_TEXT) : '',
				'url' => $base . '#/msg/' . $mailboxId . '/' . $messageId,
				'tag' => 'message-' . $messageId,
				'icon' => $icon,
			];
		}
		return ['userId' => $userId, 'payloads' => $payloads];
	}
}
