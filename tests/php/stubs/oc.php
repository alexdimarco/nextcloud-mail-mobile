<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// OCP\Util::addHeader() hands over to this Nextcloud server class.
// Here it just records the headers so tests can look at them.

// phpcs:ignore
class OC_Util {
	/** @var list<array{tag: string, attributes: array, text: ?string}> */
	public static array $headers = [];

	public static function addHeader($tag, $attributes, $text = null): void {
		self::$headers[] = ['tag' => $tag, 'attributes' => $attributes, 'text' => $text];
	}
}
