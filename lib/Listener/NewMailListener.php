<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Listener;

use OCA\MailMobile\BackgroundJob\PushJob;
use OCA\MailMobile\Mail\MailBridge;
use OCA\MailMobile\Service\PushService;
use OCP\BackgroundJob\IJobList;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * When Mail stores new inbox mail, queue a notification job for that user.
 *
 * Only ids go into the job, never sender names or subjects: the job table
 * is plain text. The job reads the details through Mail when it runs.
 *
 * @template-implements IEventListener<Event>
 */
class NewMailListener implements IEventListener {
	public function __construct(
		private MailBridge $bridge,
		private PushService $pushService,
		private IJobList $jobList,
		private LoggerInterface $logger,
	) {
	}

	#[\Override]
	public function handle(Event $event): void {
		try {
			$newMail = $this->bridge->readNewMessages($event);
			if ($newMail === null || $newMail->userId === '') {
				return;
			}
			if (!$this->bridge->isUsable($newMail->userId)) {
				return;
			}
			if (!$this->pushService->hasSubscriptions($newMail->userId)) {
				return;
			}
			// Sending means round trips to outside push services, and this
			// event fires inside a mail sync someone may be waiting on
			$this->jobList->add(PushJob::class, [
				'userId' => $newMail->userId,
				'accountId' => $newMail->accountId,
				'mailboxId' => $newMail->mailboxId,
				'messageIds' => $newMail->messageIds,
				'count' => $newMail->count,
			]);
		} catch (Throwable $e) {
			// A notification problem must never break Mail's sync
			$this->logger->warning('Could not queue a mail notification: ' . $e->getMessage(), ['exception' => $e]);
		}
	}
}
