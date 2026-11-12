<?php
/**
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** @var array{url: string, usable: bool, found: string, showDetails: bool, preferencesUrl: string, devices: list<array{id: int, device: string, added: string, removeUrl: string}>, sourceUrl: string, requesttoken: string} $_ */
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

	<h3><?php echo $e($l->t('Notifications')); ?></h3>
	<form method="post" action="<?php echo $e($_['preferencesUrl']); ?>">
		<input type="hidden" name="requesttoken" value="<?php echo $e($_['requesttoken']); ?>">
		<p>
			<input type="checkbox" class="checkbox" id="mail-mobile-show-details" name="showDetails" value="1" <?php if ($_['showDetails']): ?>checked<?php endif; ?>>
			<label for="mail-mobile-show-details"><?php echo $e($l->t('Show sender and subject in notifications')); ?></label>
		</p>
		<p><em><?php echo $e($l->t('Phones show notifications on the lock screen. When this is off, notifications only say "New mail".')); ?></em></p>
		<p><button type="submit"><?php echo $e($l->t('Save')); ?></button></p>
	</form>

	<h3><?php echo $e($l->t('Devices that get notifications')); ?></h3>
	<?php if ($_['devices'] === []): ?>
		<p><?php echo $e($l->t('None. Turn notifications on from the phone page.')); ?></p>
	<?php else: ?>
		<p><?php echo $e($l->t('Remove a device you no longer use, or one you lost. Signing out on a device, or removing it under Security, also stops its notifications.')); ?></p>
		<ul>
			<?php foreach ($_['devices'] as $device): ?>
				<li>
					<form method="post" action="<?php echo $e($device['removeUrl']); ?>">
						<input type="hidden" name="requesttoken" value="<?php echo $e($_['requesttoken']); ?>">
						<?php echo $e($device['device'] !== '' ? $device['device'] : $l->t('Unknown browser')); ?>
						· <?php echo $e($l->t('added %s', [$device['added']])); ?>
						<button type="submit"><?php echo $e($l->t('Remove')); ?></button>
					</form>
				</li>
			<?php endforeach; ?>
		</ul>
	<?php endif; ?>

	<?php if ($_['sourceUrl'] !== ''): ?>
		<p><a href="<?php echo $e($_['sourceUrl']); ?>" target="_blank" rel="noopener noreferrer"><?php echo $e($l->t('Source code (AGPL licence)')); ?></a></p>
	<?php endif; ?>
</div>
