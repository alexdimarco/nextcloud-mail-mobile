<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Mail;

use OCA\Mail\Events\NewMessagesSynchronized;
use OCA\Mail\Service\MailManager;
use OCP\App\IAppManager;
use OCP\EventDispatcher\Event;
use OCP\IL10N;
use OCP\IUserManager;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;
use Throwable;
use function array_slice;
use function class_exists;
use function count;
use function preg_replace;
use function version_compare;

/**
 * The only place in this app that touches the Mail app's PHP code.
 *
 * Mail's classes are not a public interface: they can change in any Mail
 * release. Keeping every use of them here means a Mail update can only
 * break this one file, and {@see self::status()} turns a mismatch into a
 * plain message instead of a crash.
 *
 * Referencing a missing class with `::class` or `instanceof` never loads
 * it, so this file is safe to load on a server without Mail.
 */
class MailBridge {
	/** Mail's event for "a sync stored new messages", listened to by class name */
	public const NEW_MESSAGES_EVENT = NewMessagesSynchronized::class;

	/**
	 * Oldest Mail version this app was built and tested against. Tested:
	 * Mail 5.13.2 and Mail 6.0.0-alpha.3, on Nextcloud 33, 34 and 35.
	 */
	public const MIN_MAIL_VERSION = '5.13.0';
	/** First Mail version this app refuses until it has been tested */
	public const MAX_MAIL_VERSION_EXCLUSIVE = '7.0.0';
	/** The same range, as people read it: "version 5.13 to 6.x" */
	public const MIN_MAIL_LABEL = '5.13';
	public const MAX_MAIL_LABEL = '6.x';

	/** At most this many message ids are carried into one notification job */
	public const MAX_MESSAGES = 3;

	/** @var list<class-string> Mail classes this app depends on */
	private const REQUIRED_CLASSES = [
		NewMessagesSynchronized::class,
		MailManager::class,
	];

	public function __construct(
		private IAppManager $appManager,
		private IUserManager $userManager,
		private ContainerInterface $container,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Whether Mail can be used for this user, and if not, why not.
	 */
	public function status(?string $userId): MailStatus {
		if (!$this->appManager->isInstalled('mail')) {
			return MailStatus::unusable(null, 'Mail is not installed or not enabled');
		}
		$version = $this->appManager->getAppVersion('mail');
		if ($userId !== null) {
			$user = $this->userManager->get($userId);
			if ($user === null || !$this->appManager->isEnabledForUser('mail', $user)) {
				return MailStatus::unusable($version, 'Mail is not enabled for your account');
			}
		}
		if (!self::isSupportedVersion($version)) {
			return MailStatus::unusable($version, 'Mail ' . $version);
		}
		foreach (self::REQUIRED_CLASSES as $class) {
			if (!class_exists($class)) {
				return MailStatus::unusable($version, 'Mail ' . $version . ', but parts of it that Mail Mobile uses are missing');
			}
		}
		return MailStatus::usable($version);
	}

	public function isUsable(?string $userId): bool {
		return $this->status($userId)->usable;
	}

	/**
	 * The plain message shown on the phone page and in personal settings
	 * when Mail cannot be used, for example "Mail Mobile needs the Mail app,
	 * version 5.13 to 6.x. This server has: Mail 7.0.0."
	 *
	 * @param string $found what was found instead, from {@see MailStatus::$found}
	 */
	public static function needsMailMessage(IL10N $l, string $found): string {
		return $l->t('Mail Mobile needs the Mail app, version %1$s to %2$s. This server has: %3$s.', [
			self::MIN_MAIL_LABEL,
			self::MAX_MAIL_LABEL,
			$found,
		]);
	}

	/**
	 * Pre-releases count as the release they lead to, so a 5.13 release
	 * candidate and a 6.0 alpha are accepted, and a 7.0 beta is refused
	 * like 7.0 itself.
	 */
	public static function isSupportedVersion(string $version): bool {
		$release = (string)preg_replace('/[-+].*$/', '', $version);
		return $release !== ''
			&& version_compare($release, self::MIN_MAIL_VERSION, '>=')
			&& version_compare($release, self::MAX_MAIL_VERSION_EXCLUSIVE, '<');
	}

	/**
	 * Read Mail's "new messages" event down to plain ids.
	 *
	 * @return ?NewMail null when the event is not about new inbox mail
	 */
	public function readNewMessages(Event $event): ?NewMail {
		if (!$event instanceof NewMessagesSynchronized) {
			return null;
		}
		try {
			$mailbox = $event->getMailbox();
			// Mail 6 itself treats a mailbox as the inbox when it is marked
			// so or is named INBOX (MailboxMapper::findSpecialUseMailbox);
			// both checks exist in Mail 5.13 too
			if (!$mailbox->isSpecialUse('inbox') && !$mailbox->isInbox()) {
				return null;
			}
			$messages = $event->getMessages();
			if ($messages === []) {
				return null;
			}
			$account = $event->getAccount();
			$ids = [];
			foreach (array_slice($messages, 0, self::MAX_MESSAGES) as $message) {
				$ids[] = (int)$message->getId();
			}
			return new NewMail(
				(string)$account->getUserId(),
				(int)$account->getId(),
				(int)$mailbox->getId(),
				$ids,
				count($messages),
			);
		} catch (Throwable $e) {
			$this->logger->warning('Could not read the new-mail event from Mail: ' . $e->getMessage(), ['exception' => $e]);
			return null;
		}
	}

	/**
	 * The sender and subject of one message, read through Mail.
	 *
	 * Mail only returns the message when it belongs to this user.
	 *
	 * @return ?array{from: string, email: string, subject: string} null when it cannot be read
	 */
	public function describe(string $userId, int $messageId): ?array {
		try {
			/** @var MailManager $manager */
			$manager = $this->container->get(MailManager::class);
			$message = $manager->getMessage($userId, $messageId);
			$from = $message->getFrom()->first();
			$email = $from !== null ? ($from->getEmail() ?? '') : '';
			$sender = $from !== null ? ($from->getLabel() ?? $email) : '';
			return [
				'from' => $sender,
				'email' => $email,
				'subject' => $message->getSubject() ?? '',
			];
		} catch (Throwable $e) {
			$this->logger->info('Could not read message ' . $messageId . ' through Mail: ' . $e->getMessage());
			return null;
		}
	}
}
