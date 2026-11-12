<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

namespace OCA\MailMobile\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * The table of phones and browsers that asked for push notifications
 */
class Version000100Date20261112000000 extends SimpleMigrationStep {
	#[\Override]
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('mail_mobile_push_subs')) {
			return null;
		}
		$table = $schema->createTable('mail_mobile_push_subs');
		$table->addColumn('id', Types::BIGINT, [
			'autoincrement' => true,
			'notnull' => true,
		]);
		$table->addColumn('user_id', Types::STRING, [
			'notnull' => true,
			'length' => 64,
		]);
		// sha256 of the push address, so the long address can be unique
		$table->addColumn('endpoint_hash', Types::STRING, [
			'notnull' => true,
			'length' => 64,
		]);
		$table->addColumn('endpoint', Types::TEXT, [
			'notnull' => true,
		]);
		$table->addColumn('pubkey', Types::STRING, [
			'notnull' => true,
			'length' => 128,
		]);
		$table->addColumn('auth_token', Types::STRING, [
			'notnull' => true,
			'length' => 64,
		]);
		$table->addColumn('created_at', Types::BIGINT, [
			'notnull' => true,
		]);
		// The sign-in that turned notifications on; when it ends (sign-out,
		// device revoked in Security settings), the row is removed
		$table->addColumn('token_id', Types::BIGINT, [
			'notnull' => false,
		]);
		$table->addColumn('device', Types::STRING, [
			'notnull' => false,
			'length' => 64,
		]);
		$table->addColumn('failures', Types::INTEGER, [
			'notnull' => true,
			'default' => 0,
		]);
		$table->setPrimaryKey(['id']);
		$table->addIndex(['user_id'], 'mail_mobile_push_uid');
		$table->addIndex(['token_id'], 'mail_mobile_push_tok');
		$table->addUniqueIndex(['endpoint_hash'], 'mail_mobile_push_ep');

		return $schema;
	}
}
