/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Options for Nextcloud's t() and n() when the result is shown as text.
 *
 * By default t() HTML-escapes and sanitizes the values it inserts, for
 * results that are put into the page as HTML. This app never does that:
 * every translated string is shown with Vue's {{ }} or textContent, which
 * escape it themselves. Escaping twice shows "AT&amp;T" for "AT&T" and
 * "o&#39;brien@example.com" for "o'brien@example.com".
 *
 * Use these only where the result is shown as text, never as HTML.
 */
export const AS_TEXT = Object.freeze({ escape: false, sanitize: false })
