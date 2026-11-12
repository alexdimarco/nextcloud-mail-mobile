/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getLoggerBuilder } from '@nextcloud/logger'

export default getLoggerBuilder().setApp('mail_mobile').detectUser().build()
