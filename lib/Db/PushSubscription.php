<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * One phone or browser that asked for notifications.
 *
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method string getEndpointHash()
 * @method void setEndpointHash(string $endpointHash)
 * @method string getEndpoint()
 * @method void setEndpoint(string $endpoint)
 * @method string getPubkey()
 * @method void setPubkey(string $pubkey)
 * @method string getAuthToken()
 * @method void setAuthToken(string $authToken)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method ?int getTokenId()
 * @method void setTokenId(?int $tokenId)
 * @method ?string getDevice()
 * @method void setDevice(?string $device)
 * @method int getFailures()
 * @method void setFailures(int $failures)
 */
class PushSubscription extends Entity {
	protected $userId;
	protected $endpointHash;
	protected $endpoint;
	protected $pubkey;
	protected $authToken;
	protected $createdAt;
	/** The Nextcloud sign-in (session or app password) that turned it on */
	protected $tokenId;
	/** For the device list in settings, for example "Chrome on Android" */
	protected $device;
	/** Refusals in a row from the push service (401 or 403) */
	protected $failures = 0;

	public function __construct() {
		$this->addType('createdAt', Types::BIGINT);
		$this->addType('tokenId', Types::BIGINT);
		$this->addType('device', Types::STRING);
		$this->addType('failures', Types::INTEGER);
	}
}
