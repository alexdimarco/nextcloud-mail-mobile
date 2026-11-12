<?php
/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** @var array{url: string, usable: bool, found: string} $_ */
/** @var \OCP\IL10N $l */
$e = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
?>
<div class="section" id="mail-mobile-settings">
	<h2><?php echo $e($l->t('Mail Mobile')); ?></h2>
	<?php if ($_['usable']): ?>
		<p><?php echo $e($l->t('Open this address on your phone, sign in, then save the page to your home screen:')); ?></p>
		<p><a href="<?php echo $e($_['url']); ?>" rel="noreferrer"><?php echo $e($_['url']); ?></a></p>
		<p><?php echo $e($l->t('On the phone page, open the mailbox list (☰) to turn on notifications.')); ?></p>
	<?php else: ?>
		<p><?php echo $e($l->t('Mail Mobile needs the Mail app, version %1$s or newer and older than %2$s. This server has: %3$s.', ['5.13', '7', $_['found']])); ?></p>
	<?php endif; ?>
</div>
