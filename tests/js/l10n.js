/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The real t() and n() from @nextcloud/l10n, for mounting components in
// the tests. They escape and sanitize inserted values exactly as they do
// on a Nextcloud page, so a value escaped twice (shown as "&amp;" or
// "&#39;") makes a test fail instead of reaching people.

import { translate, translatePlural } from '@nextcloud/l10n'

export const l10nMocks = { t: translate, n: translatePlural }
