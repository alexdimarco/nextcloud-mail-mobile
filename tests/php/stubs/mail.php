<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Stand-ins for the parts of the Nextcloud Mail app that
// lib/Mail/MailBridge.php uses, with the same names and method signatures
// as Mail 5.13.2 and Mail 6.0.0-alpha.3 (checked against their source;
// every method stubbed here is the same in both). Used by the unit tests
// and by Psalm. The real classes come from Mail at run time.

namespace OCA\Mail {
	class Account {
		/** @return int */
		public function getId() {
			return 0;
		}

		/** @return string */
		public function getUserId() {
			return '';
		}

		public function getEmail(): string {
			return '';
		}
	}

	class Address {
		public function getLabel(): ?string {
			return null;
		}

		public function getEmail(): ?string {
			return null;
		}
	}

	class AddressList {
		public function first(): ?Address {
			return null;
		}
	}
}

namespace OCA\Mail\Db {
	use OCA\Mail\AddressList;

	class Mailbox {
		/** @return int */
		public function getId() {
			return 0;
		}

		public function isSpecialUse(string $specialUse): bool {
			return false;
		}

		public function isInbox(): bool {
			return false;
		}
	}

	class Message {
		/** @return int */
		public function getId() {
			return 0;
		}

		public function getFrom(): AddressList {
			return new AddressList();
		}

		public function getSubject(): ?string {
			return null;
		}
	}
}

namespace OCA\Mail\Events {
	use OCA\Mail\Account;
	use OCA\Mail\Db\Mailbox;
	use OCA\Mail\Db\Message;
	use OCP\EventDispatcher\Event;

	class NewMessagesSynchronized extends Event {
		/**
		 * @param Message[] $messages
		 */
		public function __construct(
			private Account $account,
			private Mailbox $mailbox,
			private array $messages,
		) {
			parent::__construct();
		}

		public function getAccount(): Account {
			return $this->account;
		}

		public function getMailbox(): Mailbox {
			return $this->mailbox;
		}

		/**
		 * @return Message[]
		 */
		public function getMessages() {
			return $this->messages;
		}
	}
}

namespace OCA\Mail\Service {
	use OCA\Mail\Db\Message;

	class MailManager {
		public function getMessage(string $uid, int $id): Message {
			return new Message();
		}
	}
}
