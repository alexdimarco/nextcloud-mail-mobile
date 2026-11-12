<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<PushSubscription>
 */
class PushSubscriptionMapper extends QBMapper {
	public const TABLE = 'mail_mobile_push_subs';

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, PushSubscription::class);
	}

	/**
	 * @return list<PushSubscription>
	 */
	public function findByUserId(string $userId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $this->findEntities($qb);
	}

	public function countByUserId(string $userId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'cnt'))
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$count = (int)$result->fetchOne();
		$result->closeCursor();
		return $count;
	}

	public function deleteByEndpointHash(string $userId, string $endpointHash): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('endpoint_hash', $qb->createNamedParameter($endpointHash)));
		$qb->executeStatement();
	}

	public function deleteByEndpointHashAny(string $endpointHash): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('endpoint_hash', $qb->createNamedParameter($endpointHash)));
		$qb->executeStatement();
	}

	/**
	 * Drop the user's oldest subscription, to keep the count per user bounded
	 */
	public function deleteOldestForUser(string $userId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->orderBy('created_at', 'ASC')
			->addOrderBy('id', 'ASC')
			->setMaxResults(1);
		$result = $qb->executeQuery();
		$id = $result->fetchOne();
		$result->closeCursor();
		if ($id === false) {
			return;
		}
		$del = $this->db->getQueryBuilder();
		$del->delete($this->getTableName())
			->where($del->expr()->eq('id', $del->createNamedParameter((int)$id, IQueryBuilder::PARAM_INT)));
		$del->executeStatement();
	}

	public function deleteByUserId(string $userId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}

	public function deleteAll(): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName());
		$qb->executeStatement();
	}
}
