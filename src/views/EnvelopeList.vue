<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-FileCopyrightText: 2026 Alex DiMarco
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div class="list">
		<!-- Searches as you type, after a short pause; Enter searches at once -->
		<form
			v-if="!selectionMode"
			class="search"
			role="search"
			@submit.prevent="applySearch">
			<input
				v-model="query"
				class="search__input"
				type="search"
				enterkeyhint="search"
				autocapitalize="off"
				autocomplete="off"
				:placeholder="t('mail_mobile', 'Search this folder')"
				:aria-label="t('mail_mobile', 'Search this folder')">
			<button
				v-if="query"
				type="button"
				class="search__clear"
				:aria-label="t('mail_mobile', 'Clear search')"
				@click="clearSearch">
				✕
			</button>
		</form>
		<div v-if="!selectionMode && envelopes.length > 0" class="listbar">
			<button
				class="listbar__toggle"
				:class="{ 'listbar__toggle--on': threaded }"
				:aria-pressed="threaded ? 'true' : 'false'"
				@click="toggleThreaded">
				{{ threaded ? t('mail_mobile', '✓ Conversations') : t('mail_mobile', 'Conversations: off') }}
			</button>
			<span class="listbar__spacer" />
			<button class="listbar__text" @click="enterSelectionMode">
				{{ t('mail_mobile', 'Select') }}
			</button>
		</div>
		<div v-if="selectionMode" class="selectbar">
			<button
				class="selectbar__icon"
				:aria-label="t('mail_mobile', 'Cancel selection')"
				@click="exitSelection">
				✕
			</button>
			<span class="selectbar__count">{{ t('mail_mobile', '{count} selected', { count: selection.length }) }}</span>
			<button class="selectbar__text" @click="toggleSelectAll">
				{{ allSelected ? t('mail_mobile', 'Deselect all') : t('mail_mobile', 'Select all') }}
			</button>
			<span class="selectbar__spacer" />
			<button
				v-if="canArchive"
				class="selectbar__icon"
				:disabled="selection.length === 0"
				:aria-label="t('mail_mobile', 'Archive')"
				@click="bulkArchive">
				📦
			</button>
			<button
				v-if="canMove"
				class="selectbar__icon"
				:disabled="selection.length === 0"
				:aria-label="t('mail_mobile', 'Move to…')"
				@click="openMoveSheet">
				📁
			</button>
			<button
				v-if="canJunk"
				class="selectbar__icon"
				:disabled="selection.length === 0"
				:aria-label="inJunk ? t('mail_mobile', 'Not junk: move to the inbox') : t('mail_mobile', 'Move to junk')"
				:title="inJunk ? t('mail_mobile', 'Not junk: move to the inbox') : t('mail_mobile', 'Move to junk')"
				@click="bulkJunk">
				{{ inJunk ? '📥' : '🚫' }}
			</button>
			<button
				v-if="canDelete"
				class="selectbar__icon selectbar__icon--danger"
				:disabled="selection.length === 0"
				:aria-label="t('mail_mobile', 'Delete')"
				@click="bulkDelete">
				🗑
			</button>
		</div>

		<div v-if="notice" class="list__notice">
			{{ notice }}
		</div>

		<div v-if="loadFailed && envelopes.length === 0" class="list__status">
			{{ t('mail_mobile', 'Could not load the messages.') }}
			<button class="list__retry" @click="refresh">
				{{ t('mail_mobile', 'Try again') }}
			</button>
		</div>
		<div v-else-if="(loading || syncing) && envelopes.length === 0" class="list__status">
			{{ t('mail_mobile', 'Loading …') }}
		</div>
		<div v-else-if="envelopes.length === 0" class="list__status">
			{{ searchText
				? t('mail_mobile', 'Nothing found for "{text}"', { text: searchText }, AS_TEXT)
				: t('mail_mobile', 'No messages') }}
		</div>
		<div v-if="syncSlow && envelopes.length > 0" class="list__syncing">
			{{ t('mail_mobile', 'Checking for new mail …') }}
		</div>

		<template v-for="row in displayRows">
			<div
				v-if="row.section"
				:key="'s-' + row.section"
				class="list__section">
				<template v-if="row.section === 'pinned'">
					<span aria-hidden="true">📌</span> {{ t('mail_mobile', 'Pinned') }}
				</template>
				<template v-else>
					{{ t('mail_mobile', 'Everything else') }}
				</template>
			</div>
			<button
				v-else-if="row.header"
				:key="'h' + row.envelope.databaseId"
				class="row row--thread-header"
				@click="collapse(row.envelope.databaseId)">
				<span class="row__avatar row__avatar--thread">💬</span>
				<span class="row__main">
					<span class="row__top">
						<span class="row__from">{{ row.envelope.subject || t('mail_mobile', '(No subject)') }}</span>
						<span class="row__chev">▾</span>
					</span>
					<span class="row__subject">
						{{ n('mail', '{count} message in this conversation', '{count} messages in this conversation', row.count, { count: row.count }) }}
					</span>
				</span>
			</button>
			<div
				v-else
				:key="(row.child ? 'c' : 'p') + row.envelope.databaseId"
				class="row-wrap"
				:class="{ 'row-wrap--child': row.child }">
				<div
					v-if="isActionable(row) && activeRowId === row.envelope.databaseId && dragX !== 0"
					class="row-reveal">
					<span v-if="canArchive" class="row-reveal__side row-reveal__side--archive" aria-hidden="true">
						📦
					</span>
					<span class="row-reveal__spacer" />
					<span v-if="canDelete" class="row-reveal__side row-reveal__side--delete" aria-hidden="true">
						🗑
					</span>
				</div>
				<button
					class="row"
					:class="{
						'row--unseen': !row.envelope.flags.seen,
						'row--active': row.envelope.databaseId === selectedId,
						'row--selected': selection.includes(row.envelope.databaseId),
						'row--dragging': dragLive && isActionable(row) && activeRowId === row.envelope.databaseId,
						'row--child': row.child,
						'row--loading': !row.child && threadLoadingId === row.envelope.databaseId,
					}"
					:style="rowStyle(row)"
					@pointerdown="onPointerDown(row, $event)"
					@pointermove="onPointerMove(row, $event)"
					@pointerup="onPointerUp(row)"
					@pointercancel="onPointerCancel"
					@click="onRowClick(row, $event)">
					<span v-if="selectionMode && isActionable(row)" class="row__check" :class="{ 'row__check--on': selection.includes(row.envelope.databaseId) }">
						✓
					</span>
					<span v-else class="row__avatar">{{ initial(row.envelope) }}</span>
					<span class="row__main">
						<span class="row__top">
							<span class="row__from"><span v-if="!row.envelope.flags.seen" class="row__dot" />{{ senderOf(row.envelope) }}</span>
							<span class="row__date">{{ formatDate(row.envelope.dateInt) }}</span>
						</span>
						<span class="row__subject">
							<span
								v-if="isPinned(row.envelope)"
								class="row__pin"
								role="img"
								:aria-label="t('mail_mobile', 'Pinned')">📌</span>
							<span v-if="row.envelope.flags.flagged" class="row__star">★</span>
							<span v-if="row.envelope.flags.hasAttachments" class="row__clip">📎</span>
							{{ row.envelope.subject || t('mail_mobile', '(No subject)') }}
						</span>
						<span class="row__preview">{{ row.envelope.previewText }}</span>
					</span>
					<span
						v-if="isConversation(row)"
						class="row__disclosure"
						:aria-label="t('mail_mobile', 'Conversation — tap to expand')">
						›
					</span>
				</button>
			</div>
		</template>

		<button
			v-if="envelopes.length > 0 && !exhausted"
			class="list__more"
			:disabled="loading"
			@click="loadMore">
			{{ loading ? t('mail_mobile', 'Loading …') : t('mail_mobile', 'Load more') }}
		</button>

		<div v-if="moveSheetOpen" class="movesheet-backdrop" @click.self="moveSheetOpen = false">
			<div class="movesheet">
				<h3 class="movesheet__title">
					{{ t('mail_mobile', 'Move to…') }}
				</h3>
				<button
					v-for="dest in moveDestinations"
					:key="dest.databaseId"
					class="movesheet__box"
					@click="confirmMove(dest.databaseId)">
					{{ dest.displayName }}
				</button>
				<button class="movesheet__cancel" @click="moveSheetOpen = false">
					{{ t('mail_mobile', 'Cancel') }}
				</button>
			</div>
		</div>
	</div>
</template>

<script>
import { deleteMessage, fetchEnvelopes, fetchThread, isPinned, looksLikeConversation, moveMessage, pinnedFilter, searchFilter, setJunk, syncMailbox } from '../api/mail.js'
import { AS_TEXT } from '../l10nText.js'
import logger from '../logger.js'
import { recallList, recallSearch, rememberList, rememberSearch } from '../memory.js'
import { accountFor, setThreaded, store } from '../store.js'

// Mail sends 25 messages at a time
const PAGE_SIZE = 25
// Only when checking for new mail takes longer than this does the list say
// so; a quick check would just flicker
const SLOW_SYNC_MS = 1500
// Typing searches once the person pauses this long
const SEARCH_PAUSE_MS = 500
// Mail's own search box looks for at least 2 letters
const SEARCH_MIN_LENGTH = 2

/**
 * The element that scrolls the list: the page area on a phone, the list
 * column on a wide screen.
 *
 * @param {HTMLElement} element the list
 * @return {HTMLElement|null} the scrolling element, if any
 */
function scrollParent(element) {
	for (let node = element?.parentElement; node; node = node.parentElement) {
		const overflowY = window.getComputedStyle(node).overflowY
		if (overflowY === 'auto' || overflowY === 'scroll') {
			return node
		}
	}
	return null
}

/**
 * The rows for some messages: one per message in flat view; in threaded
 * view, a conversation row per thread, with an expanded thread's messages
 * right after it (and its row shown as a slim header while expanded).
 *
 * @param {Array} envelopes the messages
 * @param {object} view how the list is shown
 * @param {boolean} view.threaded whether conversations are grouped
 * @param {Array<number>} view.expandedIds the expanded conversations
 * @param {object} view.threadChildren the messages of each expanded conversation
 * @return {Array<object>} the rows
 */
function rowsFor(envelopes, { threaded, expandedIds, threadChildren }) {
	if (!threaded) {
		return envelopes.map((envelope) => ({ envelope, child: false, header: false }))
	}
	const rows = []
	for (const envelope of envelopes) {
		const expanded = expandedIds.includes(envelope.databaseId)
		const children = threadChildren[envelope.databaseId] ?? []
		rows.push({ envelope, child: false, header: expanded, expanded, count: children.length })
		if (expanded) {
			for (const child of children) {
				rows.push({ envelope: child, child: true, header: false })
			}
		}
	}
	return rows
}

const LONG_PRESS_MS = 500
const SWIPE_ACTIVATE_PX = 10
const SWIPE_MAX_PX = 96
const SWIPE_THRESHOLD_PX = 64

export default {
	name: 'EnvelopeList',
	props: {
		mailbox: {
			type: Object,
			required: true,
		},

		refreshTick: {
			type: Number,
			default: 0,
		},

		selectedId: {
			type: Number,
			default: null,
		},
	},

	data() {
		// The list as last seen during this visit, shown at once, with the
		// search it showed (back from a message returns to the same search)
		const searchText = recallSearch(this.mailbox.databaseId)
		const remembered = recallList(this.mailbox.databaseId, store.threaded, searchText)
		return {
			AS_TEXT,
			// What is in the search box, and what the list shows results for
			query: searchText,
			searchText,
			searchTimer: null,
			envelopes: remembered ? [...remembered.envelopes] : [],
			// The folder's pinned messages, shown above the rest when not
			// searching
			pinned: remembered?.pinned ? [...remembered.pinned] : [],
			loading: false,
			// A refresh is running: told to the page, which turns its
			// refresh button while it does
			refreshing: false,
			// Mail is checking the mail server for new mail, in the background
			syncing: false,
			syncSlow: false,
			// The list could not be loaded and there is none to show
			loadFailed: false,
			// Counts refreshes, so an older, slower one never overwrites a newer
			refreshRun: 0,
			restoreScrollTop: remembered?.scrollTop ?? 0,
			exhausted: remembered?.exhausted ?? false,
			notice: null,
			// multi-select. selectionMode is independent of selection.length
			// so "Select" can open an empty selection ready for "Select all",
			// and deselecting the last row doesn't silently drop you out
			selectionMode: false,
			selection: [],
			moveSheetOpen: false,
			// Conversation grouping (threaded view). Top-level rows are
			// conversations; tapping one fetches its messages and expands
			// them inline. expandedIds holds the ids of expanded threads,
			// threadChildren maps each to its fetched messages.
			expandedIds: [],
			threadChildren: {},
			threadLoadingId: null,
			// swipe/long-press gesture tracking (one row at a time).
			// activeRowId + dragX describe the row's current transform,
			// whether that's a live finger-drag or an in-flight release
			// animation; dragLive is true only while the finger is still
			// down, and controls whether the transform is animated or
			// follows the pointer instantly (see .row--dragging).
			activeRowId: null,
			dragX: 0,
			dragLive: false,
			gesture: null, // null | 'swipe' | 'scroll' | 'longpress'
			touchStart: { x: 0, y: 0, id: null },
			longPressTimer: null,
		}
	},

	computed: {
		threaded() {
			return store.threaded
		},

		// The messages below the pinned ones: a pinned message (or, with
		// conversations grouped, its conversation) is shown once, on top
		rest() {
			if (this.pinned.length === 0) {
				return this.envelopes
			}
			const pinnedKeys = new Set(this.pinned.map(this.rowKey))
			return this.envelopes.filter((envelope) => !pinnedKeys.has(this.rowKey(envelope)))
		},

		// Every message shown, pinned first
		listed() {
			return [...this.pinned, ...this.rest]
		},

		// The rows to render: the pinned messages under their heading, then
		// the rest (under a heading of their own when there are pinned ones)
		displayRows() {
			const view = { threaded: this.threaded, expandedIds: this.expandedIds, threadChildren: this.threadChildren }
			if (this.pinned.length === 0) {
				return rowsFor(this.envelopes, view)
			}
			const rows = [{ section: 'pinned' }, ...rowsFor(this.pinned, view)]
			if (this.rest.length > 0) {
				rows.push({ section: 'rest' }, ...rowsFor(this.rest, view))
			}
			return rows
		},

		// The message ids the selection can currently cover: every message in
		// flat view, or the visible messages of expanded threads in threaded
		// view (conversation headers are not individually selectable)
		selectableIds() {
			if (!this.threaded) {
				return this.listed.map((envelope) => envelope.databaseId)
			}
			return this.expandedIds.flatMap((id) => (this.threadChildren[id] ?? []).map((child) => child.databaseId))
		},

		allSelected() {
			return this.selectableIds.length > 0 && this.selection.length === this.selectableIds.length
		},

		account() {
			return accountFor(this.mailbox)
		},

		// The search as Mail takes it; '' when not searching. Like Mail's
		// own search, the message text is searched only when the account's
		// "search in message body" setting is on.
		filter() {
			return searchFilter(this.searchText, { body: !!this.account?.searchBody })
		},

		// Deleting requires a trash folder to move into — same gate the
		// reader uses, and what the server enforces
		canDelete() {
			return !!this.account?.trashMailboxId
		},

		// Archiving into the mailbox we're already viewing would be a no-op
		canArchive() {
			return !!this.account?.archiveMailboxId && this.mailbox.databaseId !== this.account.archiveMailboxId
		},

		// Junk needs the account's junk folder, as Mail's server moves junk
		// there (set in the full Mail app's account settings, or found by
		// Mail when the mail server marks one)
		canJunk() {
			return !!this.account?.junkMailboxId
		},

		// In the junk folder, the same button says "not junk"
		inJunk() {
			return this.mailbox.databaseId === this.account?.junkMailboxId
		},

		moveDestinations() {
			return (this.account?.mailboxes ?? []).filter((box) => box.databaseId !== this.mailbox.databaseId)
		},

		canMove() {
			return this.moveDestinations.length > 0
		},

		// Deleting from the trash mailbox itself expunges permanently
		isPermanentDelete() {
			return this.mailbox.databaseId === this.account?.trashMailboxId
		},
	},

	watch: {
		refreshTick() {
			this.refresh()
		},

		envelopes() {
			this.keepList()
		},

		pinned() {
			this.keepList()
		},

		refreshing(value) {
			this.$emit('busy', value)
		},

		exhausted() {
			this.keepList()
		},

		query(text) {
			clearTimeout(this.searchTimer)
			const length = text.trim().length
			if (length === 0 || length >= SEARCH_MIN_LENGTH) {
				this.searchTimer = setTimeout(this.applySearch, SEARCH_PAUSE_MS)
			}
		},
	},

	created() {
		this.refresh()
		document.addEventListener('visibilitychange', this.onVisible)
	},

	mounted() {
		// Back from a message: the same place in the list
		if (this.restoreScrollTop > 0) {
			this.$nextTick(() => {
				const scroller = scrollParent(this.$el)
				if (scroller) {
					scroller.scrollTop = this.restoreScrollTop
				}
			})
		}
	},

	beforeDestroy() {
		if (this.refreshing) {
			this.$emit('busy', false)
		}
		document.removeEventListener('visibilitychange', this.onVisible)
		clearTimeout(this.longPressTimer)
		clearTimeout(this.searchTimer)
	},

	methods: {
		onVisible() {
			if (document.visibilityState === 'visible') {
				this.refresh()
			}
		},

		// Read the list again; then tell the page it is done, and whether
		// checking for new mail worked
		async refresh() {
			const run = ++this.refreshRun
			this.refreshing = true
			const checked = await this.readList(run)
			if (run === this.refreshRun) {
				this.refreshing = false
				this.$emit('refreshed', checked)
			}
		},

		/**
		 * Two steps, so a slow connection or mail server never leaves the
		 * list blank: first the list Mail already has, shown at once; then
		 * Mail checks the mail server for new mail, and the list is read
		 * again. Messages already on screen stay there if either fails.
		 *
		 * @param {number} run this refresh's number
		 * @return {Promise<boolean>} whether Mail checked for new mail and the list was read again
		 */
		async readList(run) {
			const mailboxId = this.mailbox.databaseId
			const filter = this.filter
			let firstReadFailed = false
			this.loading = true
			try {
				const { page, pinned } = await this.readFirstPage(mailboxId, filter)
				this.showList(page, run, pinned)
			} catch (error) {
				logger.error('could not load envelopes', error)
				firstReadFailed = true
				if (!error?.response) {
					// No answer at all: checking for new mail would not get one
					// either. (A folder Mail never read before answers with an
					// error, and needs that check to fill it.)
					if (run === this.refreshRun) {
						this.loadFailed = this.envelopes.length === 0
					}
					return false
				}
			} finally {
				if (run === this.refreshRun) {
					this.loading = false
				}
			}
			if (run !== this.refreshRun) {
				return false
			}
			this.syncing = true
			const slow = setTimeout(() => {
				this.syncSlow = this.syncing && run === this.refreshRun
			}, SLOW_SYNC_MS)
			try {
				await syncMailbox(mailboxId)
				const { page, pinned } = await this.readFirstPage(mailboxId, filter)
				this.showList(page, run, pinned)
				return true
			} catch (error) {
				logger.warn('could not check for new mail, showing the messages Mail already had', error)
				if (firstReadFailed && run === this.refreshRun) {
					this.loadFailed = this.envelopes.length === 0
				}
				return false
			} finally {
				clearTimeout(slow)
				if (run === this.refreshRun) {
					this.syncing = false
					this.syncSlow = false
				}
			}
		},

		/**
		 * The first page of the list, and the folder's pinned messages.
		 *
		 * @param {number} mailboxId the folder
		 * @param {string} filter the search; '' for none
		 * @return {Promise<{page: Array, pinned: Array|null}>} the messages
		 */
		async readFirstPage(mailboxId, filter) {
			const threaded = this.threaded
			const [page, pinned] = await Promise.all([
				fetchEnvelopes(mailboxId, undefined, threaded, filter),
				this.readPinned(mailboxId, threaded, filter),
			])
			return { page: page ?? [], pinned }
		},

		/**
		 * The folder's pinned messages: none while searching (the results
		 * show their mark instead), or before anything was pinned.
		 *
		 * @param {number} mailboxId the folder
		 * @param {boolean} threaded whether conversations are grouped
		 * @param {string} filter the search; '' for none
		 * @return {Promise<Array|null>} the messages; null when they could not be read, to keep those shown
		 */
		async readPinned(mailboxId, threaded, filter) {
			const tagId = store.pinnedTagId
			if (filter !== '' || !tagId) {
				return []
			}
			try {
				return await fetchEnvelopes(mailboxId, undefined, threaded, pinnedFilter(tagId)) ?? []
			} catch (error) {
				logger.warn('could not read the pinned messages', error)
				return null
			}
		},

		// Show a freshly read first page without undoing what the person is
		// doing: older messages loaded with "Load more", open conversations
		// and selected messages stay, as long as they are still there.
		showList(page, run, pinned = null) {
			if (run !== this.refreshRun) {
				return
			}
			const onPage = new Set(page.map((envelope) => envelope.databaseId))
			const oldest = Math.min(...page.map((envelope) => envelope.dateInt))
			const older = page.length >= PAGE_SIZE
				? this.envelopes.filter((envelope) => !onPage.has(envelope.databaseId) && envelope.dateInt < oldest)
				: []
			this.envelopes = [...page, ...older]
			this.exhausted = older.length > 0 ? this.exhausted : page.length < PAGE_SIZE
			if (pinned !== null) {
				this.pinned = pinned
			}
			this.loadFailed = false
			const shown = new Set(this.listed.map((envelope) => envelope.databaseId))
			this.expandedIds = this.expandedIds.filter((id) => shown.has(id))
			this.threadChildren = Object.fromEntries(Object.entries(this.threadChildren)
				.filter(([id]) => shown.has(Number(id))))
			const selectable = new Set(this.selectableIds)
			this.selection = this.selection.filter((id) => selectable.has(id))
		},

		keepList() {
			rememberList(this.mailbox.databaseId, this.threaded, { envelopes: this.envelopes, pinned: this.pinned, exhausted: this.exhausted }, this.searchText)
		},

		// Before opening a message: where the list was, for coming back
		rememberScroll() {
			const scroller = scrollParent(this.$el)
			rememberList(this.mailbox.databaseId, this.threaded, { scrollTop: scroller ? scroller.scrollTop : 0 }, this.searchText)
		},

		// Show results for what is in the search box (or the whole folder
		// when it is empty): the results remembered from earlier in this
		// visit at once, then the newest from Mail
		applySearch() {
			clearTimeout(this.searchTimer)
			const text = this.query.trim()
			if (text === this.searchText || (text.length > 0 && text.length < SEARCH_MIN_LENGTH)) {
				return
			}
			this.searchText = text
			rememberSearch(this.mailbox.databaseId, text)
			const remembered = recallList(this.mailbox.databaseId, this.threaded, text)
			this.envelopes = remembered ? [...remembered.envelopes] : []
			this.pinned = remembered?.pinned ? [...remembered.pinned] : []
			this.exhausted = remembered?.exhausted ?? false
			this.expandedIds = []
			this.threadChildren = {}
			this.loadFailed = false
			this.refresh()
		},

		clearSearch() {
			this.query = ''
			this.applySearch()
		},

		async loadMore() {
			// A page for another search or view than the one now shown is dropped
			const search = this.searchText
			const threaded = this.threaded
			this.loading = true
			try {
				const last = this.envelopes[this.envelopes.length - 1]
				const page = await fetchEnvelopes(this.mailbox.databaseId, last.dateInt, threaded, this.filter) ?? []
				if (search !== this.searchText || threaded !== this.threaded) {
					return
				}
				const known = new Set(this.envelopes.map((envelope) => envelope.databaseId))
				this.envelopes = this.envelopes.concat(page.filter((envelope) => !known.has(envelope.databaseId)))
				this.exhausted = page.length < PAGE_SIZE
			} catch (error) {
				logger.error('could not load more envelopes', error)
			} finally {
				this.loading = false
			}
		},

		isPinned,

		// What makes two rows the same entry: the message, or with
		// conversations grouped, its conversation
		rowKey(envelope) {
			return this.threaded && envelope.threadRootId
				? 'thread:' + envelope.threadRootId
				: 'message:' + envelope.databaseId
		},

		senderOf(envelope) {
			const from = envelope.from && envelope.from[0]
			return from ? (from.label || from.email) : '—'
		},

		initial(envelope) {
			return this.senderOf(envelope).charAt(0).toUpperCase()
		},

		formatDate(dateInt) {
			const date = new Date(dateInt * 1000)
			const today = new Date()
			if (date.toDateString() === today.toDateString()) {
				return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			}
			if (date.getFullYear() === today.getFullYear()) {
				return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
			}
			return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
		},

		rowStyle(row) {
			// Only actionable rows swipe; gate by row identity, not just the
			// message id, so a conversation header sharing its id with a
			// child message never picks up the child's drag transform
			if (!this.isActionable(row) || this.activeRowId !== row.envelope.databaseId) {
				return null
			}
			return { transform: `translateX(${this.dragX}px)` }
		},

		// --- conversation grouping ---------------------------------------

		// A row you can swipe/select/open directly: any message in flat view,
		// or an individual message inside an expanded thread. Conversation
		// header/collapsed rows are not — tapping them expands or opens.
		isActionable(row) {
			return !this.threaded || row.child
		},

		// A collapsed conversation row that likely holds more than one
		// message (confirmed with the thread call when tapped)
		isConversation(row) {
			return this.threaded && !row.child && !row.header
				&& looksLikeConversation(row.envelope)
		},

		toggleThreaded() {
			setThreaded(!this.threaded)
			const remembered = recallList(this.mailbox.databaseId, this.threaded, this.searchText)
			this.envelopes = remembered ? [...remembered.envelopes] : []
			this.pinned = remembered?.pinned ? [...remembered.pinned] : []
			this.exhausted = remembered?.exhausted ?? false
			this.expandedIds = []
			this.threadChildren = {}
			this.exitSelection()
			this.refresh()
		},

		async onThreadHeaderTap(envelope) {
			const id = envelope.databaseId
			if (this.expandedIds.includes(id)) {
				this.collapse(id)
				return
			}
			this.threadLoadingId = id
			try {
				const messages = await fetchThread(id) ?? []
				if (messages.length <= 1) {
					// Not actually a conversation — just open the message
					this.rememberScroll()
					this.$emit('open', envelope)
					return
				}
				this.threadChildren = { ...this.threadChildren, [id]: messages }
				this.expandedIds = [...this.expandedIds, id]
			} catch (error) {
				logger.error('could not load conversation', error)
				this.notice = this.t('mail_mobile', 'Could not load the conversation')
			} finally {
				this.threadLoadingId = null
			}
		},

		collapse(id) {
			const childIds = (this.threadChildren[id] ?? []).map((child) => child.databaseId)
			this.selection = this.selection.filter((selected) => !childIds.includes(selected))
			this.expandedIds = this.expandedIds.filter((expanded) => expanded !== id)
			const remaining = { ...this.threadChildren }
			delete remaining[id]
			this.threadChildren = remaining
		},

		// --- selection -------------------------------------------------

		enterSelectionMode() {
			this.selectionMode = true
		},

		toggleSelection(id) {
			const index = this.selection.indexOf(id)
			if (index === -1) {
				this.selection.push(id)
			} else {
				this.selection.splice(index, 1)
			}
			this.selectionMode = true
		},

		exitSelection() {
			this.selectionMode = false
			this.selection = []
		},

		toggleSelectAll() {
			this.selection = this.allSelected ? [] : [...this.selectableIds]
		},

		// --- gestures ----------------------------------------------------
		// Pointer Events unify mouse/touch/pen. A short hold with no
		// movement enters selection mode; a horizontal drag past the
		// threshold triggers archive (right) or delete (left); a plain tap
		// opens the message, or toggles its selection while selecting.
		// touch-action: pan-y (in <style>) keeps vertical scrolling native
		// while letting us own horizontal movement.

		onPointerDown(row, event) {
			// Conversation headers/collapsed threaded rows only tap (expand or
			// open); no swipe, no long-press select
			if (!this.isActionable(row)) {
				return
			}
			if (event.pointerType === 'mouse' && event.button !== 0) {
				return
			}
			const envelope = row.envelope
			this.touchStart = { x: event.clientX, y: event.clientY, id: envelope.databaseId }
			this.gesture = null
			clearTimeout(this.longPressTimer)
			this.longPressTimer = setTimeout(() => {
				if (this.gesture === null && this.touchStart.id === envelope.databaseId) {
					this.gesture = 'longpress'
					this.toggleSelection(envelope.databaseId)
					if (window.navigator.vibrate) {
						window.navigator.vibrate(10)
					}
				}
			}, LONG_PRESS_MS)
		},

		onPointerMove(row, event) {
			if (!this.isActionable(row)) {
				return
			}
			const envelope = row.envelope
			if (this.touchStart.id !== envelope.databaseId || this.gesture === 'longpress') {
				return
			}
			const dx = event.clientX - this.touchStart.x
			const dy = event.clientY - this.touchStart.y
			if (this.gesture === null) {
				if (this.selectionMode) {
					// No swipe while multi-selecting: taps only toggle rows
					return
				}
				if (Math.abs(dx) > SWIPE_ACTIVATE_PX && Math.abs(dx) > Math.abs(dy)) {
					this.gesture = 'swipe'
					this.activeRowId = envelope.databaseId
					this.dragLive = true
					clearTimeout(this.longPressTimer)
				} else if (Math.abs(dy) > SWIPE_ACTIVATE_PX) {
					this.gesture = 'scroll'
					clearTimeout(this.longPressTimer)
				}
			}
			if (this.gesture === 'swipe' && this.activeRowId === envelope.databaseId) {
				let x = Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, dx))
				// Don't drag toward an action that isn't available here
				if (x < 0 && !this.canDelete) {
					x = 0
				}
				if (x > 0 && !this.canArchive) {
					x = 0
				}
				this.dragX = x
			}
		},

		async onPointerUp(row) {
			if (!this.isActionable(row)) {
				return
			}
			const envelope = row.envelope
			clearTimeout(this.longPressTimer)
			if (this.gesture === 'swipe' && this.activeRowId === envelope.databaseId) {
				this.dragLive = false // re-enables the CSS transition for the release
				if (this.dragX <= -SWIPE_THRESHOLD_PX && this.canDelete) {
					await this.swipeDelete(envelope)
				} else if (this.dragX >= SWIPE_THRESHOLD_PX && this.canArchive) {
					await this.swipeArchive(envelope)
				} else {
					this.dragX = 0
				}
			}
			// this.gesture is left as-is here (not reset to null): the
			// native click event that follows pointerup on a <button> reads
			// it in onRowClick to tell a real tap from a swipe/long-press
			// that happened to end on this element, then clears it
		},

		onPointerCancel() {
			clearTimeout(this.longPressTimer)
			this.gesture = null
			this.dragLive = false
			this.dragX = 0
		},

		onRowClick(row, event) {
			// A swipe (even one that sprang back) or a long-press must not
			// also open the message — both still end with a native click
			if (this.gesture !== null) {
				event.preventDefault()
				this.gesture = null
				return
			}
			if (!this.isActionable(row)) {
				// A conversation row: fetch and expand it, or open it if it
				// turns out to hold a single message
				this.onThreadHeaderTap(row.envelope)
				return
			}
			if (this.selectionMode) {
				this.toggleSelection(row.envelope.databaseId)
				return
			}
			this.rememberScroll()
			this.$emit('open', row.envelope)
		},

		// --- single-row swipe actions --------------------------------------

		confirmPermanentDelete(count) {
			if (!this.isPermanentDelete) {
				return true
			}
			return window.confirm(count > 1
				? this.t('mail_mobile', 'Permanently delete {count} messages? This cannot be undone.', { count })
				: this.t('mail_mobile', 'Permanently delete this message? This cannot be undone.'))
		},

		async swipeDelete(envelope) {
			if (!this.confirmPermanentDelete(1)) {
				this.dragX = 0
				return
			}
			// dragLive is already false (set in onPointerUp), so this
			// animates smoothly to fully off-screen instead of snapping
			this.dragX = -SWIPE_MAX_PX * 3
			await this.wait(180)
			this.removeIdsFromView([envelope.databaseId])
			try {
				await deleteMessage(envelope.databaseId)
			} catch (error) {
				logger.error('could not delete message', error)
				this.notice = this.t('mail_mobile', 'Could not delete the message')
				await this.refresh()
			}
		},

		async swipeArchive(envelope) {
			this.dragX = SWIPE_MAX_PX * 3
			await this.wait(180)
			this.removeIdsFromView([envelope.databaseId])
			try {
				await moveMessage(envelope.databaseId, this.account.archiveMailboxId)
			} catch (error) {
				logger.error('could not archive message', error)
				this.notice = this.t('mail_mobile', 'Could not archive the message')
				await this.refresh()
			}
		},

		// Optimistically drop messages from the flat list and from any
		// expanded thread they belong to
		removeIdsFromView(ids) {
			const set = new Set(ids)
			this.envelopes = this.envelopes.filter((envelope) => !set.has(envelope.databaseId))
			this.pinned = this.pinned.filter((envelope) => !set.has(envelope.databaseId))
			let changed = false
			const next = {}
			for (const id of Object.keys(this.threadChildren)) {
				const filtered = this.threadChildren[id].filter((child) => !set.has(child.databaseId))
				next[id] = filtered
				changed = changed || filtered.length !== this.threadChildren[id].length
			}
			if (changed) {
				this.threadChildren = next
			}
		},

		wait(ms) {
			return new Promise((resolve) => setTimeout(resolve, ms))
		},

		// --- bulk actions --------------------------------------------------

		async bulkDelete() {
			if (!this.canDelete || this.selection.length === 0) {
				return
			}
			const ids = [...this.selection]
			if (!this.confirmPermanentDelete(ids.length)) {
				return
			}
			this.removeIdsFromView(ids)
			this.exitSelection()
			const failed = await this.runBulk(ids, (id) => deleteMessage(id))
			if (failed > 0) {
				this.notice = this.n('mail', 'Could not delete {count} message', 'Could not delete {count} messages', failed, { count: failed })
				this.refresh()
			}
		},

		async bulkArchive() {
			if (!this.canArchive || this.selection.length === 0) {
				return
			}
			const ids = [...this.selection]
			const destination = this.account.archiveMailboxId
			this.removeIdsFromView(ids)
			this.exitSelection()
			const failed = await this.runBulk(ids, (id) => moveMessage(id, destination))
			if (failed > 0) {
				this.notice = this.n('mail', 'Could not archive {count} message', 'Could not archive {count} messages', failed, { count: failed })
				this.refresh()
			}
		},

		// Junk, or in the junk folder not junk: Mail's server moves them to
		// the junk folder, or back to the inbox
		async bulkJunk() {
			if (!this.canJunk || this.selection.length === 0) {
				return
			}
			const ids = [...this.selection]
			const junk = !this.inJunk
			this.removeIdsFromView(ids)
			this.exitSelection()
			const failed = await this.runBulk(ids, (id) => setJunk(id, junk))
			if (failed > 0) {
				this.notice = junk
					? this.n('mail', 'Could not move {count} message to junk', 'Could not move {count} messages to junk', failed, { count: failed })
					: this.n('mail', 'Could not move {count} message to the inbox', 'Could not move {count} messages to the inbox', failed, { count: failed })
				this.refresh()
			}
		},

		openMoveSheet() {
			if (this.selection.length === 0) {
				return
			}
			this.moveSheetOpen = true
		},

		async confirmMove(destMailboxId) {
			const ids = [...this.selection]
			this.moveSheetOpen = false
			this.removeIdsFromView(ids)
			this.exitSelection()
			const failed = await this.runBulk(ids, (id) => moveMessage(id, destMailboxId))
			if (failed > 0) {
				this.notice = this.n('mail', 'Could not move {count} message', 'Could not move {count} messages', failed, { count: failed })
				this.refresh()
			}
		},

		/**
		 * Runs an action for every id concurrently and reports how many failed.
		 * On any failure the caller re-syncs from the server rather than
		 * trying to reconcile individual rows.
		 *
		 * @param {Array} ids the message ids
		 * @param {(id: number) => Promise} action performs the action for one id
		 * @return {Promise<number>} the number of failures
		 */
		async runBulk(ids, action) {
			const results = await Promise.allSettled(ids.map((id) => action(id)))
			return results.filter((result) => result.status === 'rejected').length
		},
	},
}
</script>

<style scoped>
.list {
	display: flex;
	flex-direction: column;
	padding-bottom: 90px;
}
.list__status {
	padding: 40px 16px;
	text-align: center;
	color: var(--mob-text-muted);
}
.list__retry {
	display: block;
	margin: 16px auto 0;
	padding: 10px 16px;
	border: 1px solid var(--mob-accent);
	border-radius: var(--mob-radius);
	background: var(--mob-accent-soft);
	color: var(--mob-accent);
	font-size: 14px;
	cursor: pointer;
}
.list__syncing {
	padding: 4px 16px;
	font-size: 12px;
	color: var(--mob-text-muted);
}
/* "Pinned" above the pinned messages, "Everything else" below them */
.list__section {
	padding: 10px 16px 4px;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.02em;
	text-transform: uppercase;
	color: var(--mob-text-muted);
}
.list__notice {
	margin: 8px 16px;
	padding: 10px 12px;
	border-radius: var(--mob-radius);
	background-color: var(--mob-hover);
	color: var(--mob-danger);
	font-size: 13px;
}
.list__more {
	margin: 12px 16px;
	padding: 12px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	background: transparent;
	color: var(--mob-text);
	cursor: pointer;
}
/* Scrolls away with the list; the bar below it stays at the top */
.search {
	position: relative;
	display: flex;
	align-items: center;
	margin: 8px 12px 2px;
}
.search__input {
	flex: 1;
	min-width: 0;
	box-sizing: border-box;
	height: 40px;
	padding-block: 0;
	padding-inline: 12px 40px;
	border: 1px solid var(--mob-border);
	border-radius: 999px;
	background-color: var(--mob-hover);
	color: var(--mob-text);
	/* 16px or more: phones do not zoom the page in on it */
	font-size: 16px;
}
.search__input:focus-visible {
	outline: 2px solid var(--mob-accent);
	outline-offset: 1px;
}
/* The ✕ below clears it; not the browser's own as well */
.search__input::-webkit-search-cancel-button {
	-webkit-appearance: none;
	appearance: none;
}
.search__clear {
	position: absolute;
	inset-inline-end: 4px;
	width: 36px;
	height: 36px;
	border: none;
	border-radius: 50%;
	background: transparent;
	color: var(--mob-text-muted);
	font-size: 15px;
	cursor: pointer;
}
.listbar {
	position: sticky;
	top: 0;
	z-index: 2;
	display: flex;
	align-items: center;
	padding: 6px 12px;
	background-color: var(--mob-bg);
}
.listbar__spacer {
	flex: 1;
}
.listbar__text {
	border: none;
	background: transparent;
	color: var(--mob-accent);
	font-size: 13px;
	padding: 6px 4px;
	cursor: pointer;
}
.listbar__toggle {
	border: 1px solid var(--mob-border);
	border-radius: 999px;
	background: transparent;
	color: var(--mob-text-muted);
	font-size: 13px;
	padding: 5px 12px;
	cursor: pointer;
}
/* Solid fill when on, plain outline when off, so the state is obvious */
.listbar__toggle--on {
	border-color: var(--mob-accent);
	background-color: var(--mob-accent);
	color: var(--mob-accent-text);
	font-weight: 600;
}
.selectbar {
	position: sticky;
	top: 0;
	z-index: 2;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	background-color: var(--mob-bg);
	border-bottom: 1px solid var(--mob-border);
}
.selectbar__icon {
	flex: none;
	width: 36px;
	height: 36px;
	border: none;
	border-radius: 50%;
	background: transparent;
	color: var(--mob-text);
	font-size: 16px;
	cursor: pointer;
}
.selectbar__icon:disabled {
	color: var(--mob-text-muted);
	cursor: default;
	opacity: 0.5;
}
.selectbar__icon--danger {
	color: var(--mob-danger);
}
.selectbar__icon--danger:disabled {
	color: var(--mob-text-muted);
}
.selectbar__count {
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
}
.selectbar__text {
	border: none;
	background: transparent;
	color: var(--mob-accent);
	font-size: 13px;
	cursor: pointer;
	white-space: nowrap;
}
.selectbar__spacer {
	flex: 1;
}
.row-wrap {
	position: relative;
	overflow: hidden;
}
.row-reveal {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: stretch;
}
.row-reveal__side {
	flex: none;
	width: 96px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 20px;
}
.row-reveal__side--archive {
	background-color: var(--mob-archive-soft);
}
.row-reveal__side--delete {
	background-color: var(--mob-danger-soft);
}
.row-reveal__spacer {
	flex: 1;
}
.row {
	position: relative;
	display: flex;
	gap: 12px;
	width: 100%;
	padding: 12px 16px;
	border: none;
	border-bottom: 1px solid var(--mob-border);
	background-color: var(--mob-bg);
	text-align: start;
	cursor: pointer;
	touch-action: pan-y;
}
.row--dragging {
	transition: none;
}
.row:not(.row--dragging) {
	transition: transform 180ms ease;
}
.row:active {
	background-color: var(--mob-hover);
}
.row__avatar {
	flex: none;
	width: 40px;
	height: 40px;
	border-radius: 50%;
	background-color: var(--mob-accent-soft);
	color: var(--mob-accent);
	display: flex;
	align-items: center;
	justify-content: center;
	font-weight: 600;
	font-size: 16px;
}
.row__check {
	flex: none;
	width: 40px;
	height: 40px;
	border-radius: 50%;
	border: 2px solid var(--mob-border);
	color: transparent;
	display: flex;
	align-items: center;
	justify-content: center;
	font-weight: 700;
	font-size: 18px;
}
.row__check--on {
	background-color: var(--mob-accent);
	border-color: var(--mob-accent);
	color: var(--mob-accent-text);
}
.row__main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.row__top {
	display: flex;
	justify-content: space-between;
	gap: 8px;
}
.row__from {
	font-size: 15px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.row__date {
	flex: none;
	font-size: 12px;
	color: var(--mob-text-muted);
}
.row__dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background-color: var(--mob-accent);
	margin-inline-end: 6px;
	vertical-align: 1px;
}
.row__subject {
	color: var(--mob-text-muted);
	font-size: 14px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.row__star {
	color: var(--mob-star);
}
.row__pin {
	font-size: 12px;
}
.row__clip {
	font-size: 12px;
}
.row__preview {
	font-size: 13px;
	color: var(--mob-text-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.row--unseen {
	background-color: var(--mob-unread-bg);
}
.row--unseen .row__from,
.row--unseen .row__subject {
	color: var(--mob-text);
	font-weight: 700;
}
/* Selection and the open-message highlight take precedence over the
   unread tint, so they must come after it here (equal specificity) */
.row--active {
	background-color: var(--mob-accent-soft);
}
.row--selected {
	background-color: var(--mob-accent-soft);
}
/* Conversation header shown in place of the collapsed row while expanded */
.row--thread-header {
	background-color: var(--mob-hover);
}
.row__avatar--thread {
	background-color: transparent;
	font-size: 20px;
}
.row__chev {
	flex: none;
	color: var(--mob-text-muted);
	font-size: 12px;
}
/* Disclosure chevron marking a collapsed multi-message conversation */
.row__disclosure {
	flex: none;
	align-self: center;
	color: var(--mob-text-muted);
	font-size: 20px;
	line-height: 1;
}
/* Individual messages inside an expanded conversation, indented under it */
.row-wrap--child {
	border-inline-start: 2px solid var(--mob-accent-soft);
}
.row--child {
	padding-inline-start: 40px;
}
/* Brief feedback while a tapped conversation's messages are fetched */
.row--loading {
	opacity: 0.55;
}
.movesheet-backdrop {
	position: fixed;
	inset: 0;
	z-index: 5;
	display: flex;
	align-items: flex-end;
	background-color: rgba(0, 0, 0, 0.4);
}
.movesheet {
	width: 100%;
	max-height: 70vh;
	overflow-y: auto;
	background-color: var(--mob-bg);
	border-radius: var(--mob-radius) var(--mob-radius) 0 0;
	padding: 8px 0 calc(env(safe-area-inset-bottom, 0px) + 12px);
}
.movesheet__title {
	margin: 8px 16px;
	font-size: 15px;
}
.movesheet__box {
	display: block;
	width: 100%;
	padding: 12px 16px;
	border: none;
	background: transparent;
	color: var(--mob-text);
	font-size: 15px;
	text-align: start;
	cursor: pointer;
}
.movesheet__box:active {
	background-color: var(--mob-hover);
}
.movesheet__cancel {
	display: block;
	width: calc(100% - 32px);
	margin: 8px 16px 0;
	padding: 12px;
	border: 1px solid var(--mob-border);
	border-radius: var(--mob-radius);
	background: transparent;
	color: var(--mob-text);
	cursor: pointer;
}
</style>
