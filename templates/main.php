<?php
/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** @var array{needsMail: ?string, script: ?string, version: string} $_ */

if ($_['script'] !== null) {
	\OCP\Util::addScript('mail_mobile', $_['script']);
}
?>
<?php if ($_['needsMail'] !== null): ?>
<main class="mail-mobile-needs-mail" style="max-width: 32em; margin: 3em auto; padding: 0 16px; font: 16px/1.5 system-ui, sans-serif; color: #1b2430; background: #fff; text-align: start;">
	<h1 style="font-size: 1.4em;">Mail Mobile</h1>
	<p id="mail-mobile-needs-mail"><?php echo htmlspecialchars($_['needsMail'], ENT_QUOTES | ENT_HTML5, 'UTF-8'); ?></p>
	<p style="color: #67707c; font-size: 0.85em;">Mail Mobile <?php echo htmlspecialchars($_['version'], ENT_QUOTES | ENT_HTML5, 'UTF-8'); ?></p>
</main>
<?php else: ?>
<div id="mail-mobile"></div>
<noscript>
	<p style="padding: 16px;">Mail Mobile needs JavaScript.</p>
</noscript>
<?php endif; ?>
