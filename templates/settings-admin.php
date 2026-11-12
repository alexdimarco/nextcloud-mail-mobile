<?php
/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** @var array{configured: string, effective: ?string, keysState: string, saveUrl: string, invalid: bool, requesttoken: string} $_ */
/** @var \OCP\IL10N $l */
$e = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
?>
<div class="section" id="mail-mobile-admin">
	<h2><?php echo $e($l->t('Mail Mobile notifications')); ?></h2>

	<?php if ($_['keysState'] !== 'ok'): ?>
		<p class="warning"><?php echo $e($l->t('Notifications are off: the server\'s push keys are missing or cannot be read. Run this command on the server: occ mail_mobile:vapid:reset')); ?></p>
	<?php endif; ?>

	<p><?php echo $e($l->t('Push services (Google, Apple, Mozilla, Microsoft) need a contact address for this server. Use an email address you read, written as mailto:you@example.com, or an https:// address.')); ?></p>

	<?php if ($_['invalid']): ?>
		<p class="warning"><?php echo $e($l->t('That was not saved: the address must start with mailto: or https://.')); ?></p>
	<?php endif; ?>
	<?php if ($_['effective'] === null): ?>
		<p class="warning"><?php echo $e($l->t('No usable contact address is set, and the server\'s "overwrite.cli.url" setting is not an https:// address. Some push services, Apple\'s among them, may refuse notifications until you set one.')); ?></p>
	<?php elseif ($_['configured'] === ''): ?>
		<p><?php echo $e($l->t('Using the server address %s for now.', [$_['effective']])); ?></p>
	<?php endif; ?>

	<form method="post" action="<?php echo $e($_['saveUrl']); ?>">
		<input type="hidden" name="requesttoken" value="<?php echo $e($_['requesttoken']); ?>">
		<label for="mail-mobile-subject"><?php echo $e($l->t('Contact address')); ?></label>
		<input type="text" id="mail-mobile-subject" name="subject" placeholder="mailto:admin@example.com" value="<?php echo $e($_['configured']); ?>">
		<button type="submit"><?php echo $e($l->t('Save')); ?></button>
	</form>
</div>
