<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\MailMobile\Tests\Unit;

use Throwable;
use function get_object_vars;
use function ini_set;
use function is_array;
use function is_object;
use function is_scalar;
use function json_encode;

/**
 * An exception's trace written out the way Nextcloud's log writes it
 * (lib/private/Log/ExceptionSerializer.php, encodeArg): string and array
 * arguments as they are, objects as their class and public fields. A
 * parameter marked #[\SensitiveParameter] arrives as a
 * \SensitiveParameterValue object, whose value is private, so only its
 * class name is written.
 */
final class LoggedTrace {
	/**
	 * PHP keeps call arguments in traces unless zend.exception_ignore_args
	 * is on (php.ini-production turns it on, PHP's own default is off).
	 * Turn it off so a test sees what a server with the default writes.
	 *
	 * @return string the previous setting, for {@see self::restore()}
	 */
	public static function keepArguments(): string {
		return (string)ini_set('zend.exception_ignore_args', '0');
	}

	public static function restore(string $previous): void {
		ini_set('zend.exception_ignore_args', $previous);
	}

	public static function text(Throwable $e): string {
		$frames = [];
		for ($current = $e; $current !== null; $current = $current->getPrevious()) {
			$frames[] = $current::class . ': ' . $current->getMessage();
			foreach ($current->getTrace() as $frame) {
				$frames[] = [
					($frame['class'] ?? '') . ($frame['type'] ?? '') . $frame['function'],
					self::encode($frame['args'] ?? []),
				];
			}
		}
		return (string)json_encode($frames, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
	}

	private static function encode(mixed $value, int $depth = 5): mixed {
		if (is_object($value)) {
			$encoded = ['__class__' => $value::class];
			if ($depth > 0) {
				foreach (get_object_vars($value) as $name => $field) {
					$encoded[$name] = self::encode($field, $depth - 1);
				}
			}
			return $encoded;
		}
		if (is_array($value)) {
			$encoded = [];
			foreach ($value as $key => $item) {
				$encoded[$key] = $depth > 0 ? self::encode($item, $depth - 1) : '…';
			}
			return $encoded;
		}
		return is_scalar($value) || $value === null ? $value : (string)$value;
	}
}
