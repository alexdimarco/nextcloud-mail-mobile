<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Mail;

/**
 * New inbox mail, reduced to ids. Nothing here is private message content,
 * so it can sit in the background-job table until the job runs.
 */
final class NewMail {
	/**
	 * @param list<int> $messageIds at most {@see MailBridge::MAX_MESSAGES}
	 * @param int $count how many new messages arrived in total
	 */
	public function __construct(
		public readonly string $userId,
		public readonly int $accountId,
		public readonly int $mailboxId,
		public readonly array $messageIds,
		public readonly int $count,
	) {
	}
}
