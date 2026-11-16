<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\BackgroundJob;

use OCA\MailMobile\AppInfo\Application;
use OCA\MailMobile\Mail\MailBridge;
use OCA\MailMobile\Service\Preferences;
use OCA\MailMobile\Service\PushService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use Psr\Log\LoggerInterface;
use Throwable;
use function count;
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
		private Preferences $preferences,
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
	 * The notifications for one batch of new mail.
	 *
	 * Addresses are only the part after "#": this runs in cron, where the
	 * server's own web address is often unknown, and the phone resolves the
	 * fragment against the page it was installed from.
	 *
	 * Sender and subject are only included when the person chose that:
	 * phones show notifications on the lock screen.
	 *
	 * @param mixed $argument
	 * @return ?array{userId: string, payloads: list<array{title: string, body: string, url: string, tag: string}>}
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

		$messageIds = array_values(array_filter($argument['messageIds'], 'is_int'));
		if (!$this->preferences->showDetails($userId) || $count > MailBridge::MAX_MESSAGES || $messageIds === []) {
			return ['userId' => $userId, 'payloads' => [[
				'title' => $l->t('New mail'),
				'body' => $l->n('%n new message', '%n new messages', max(1, $count)),
				'url' => $count === 1 && count($messageIds) === 1
					? '#/msg/' . $mailboxId . '/' . $messageIds[0]
					: '#/box/' . $mailboxId,
				'tag' => 'mailbox-' . $mailboxId,
			]]];
		}

		$payloads = [];
		foreach ($messageIds as $messageId) {
			$details = $this->bridge->describe($userId, $messageId);
			$payloads[] = [
				'title' => $details !== null ? $this->senderTitle($details['from'], $details['email']) : $l->t('New message'),
				'body' => $details !== null ? mb_substr($details['subject'], 0, self::MAX_TEXT) : '',
				'url' => '#/msg/' . $mailboxId . '/' . $messageId,
				'tag' => 'message-' . $messageId,
			];
		}
		return ['userId' => $userId, 'payloads' => $payloads];
	}

	/**
	 * "Name <address>": the display name alone is whatever the sender
	 * typed (for example "IT Support"), so the real address is shown too.
	 */
	private function senderTitle(string $name, string $email): string {
		$name = mb_substr($name, 0, self::MAX_TEXT);
		if ($email === '' || $name === $email) {
			return $email !== '' ? $email : $name;
		}
		return $name !== '' ? $name . ' <' . $email . '>' : $email;
	}
}
