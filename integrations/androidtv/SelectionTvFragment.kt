package org.jellyfin.androidtv.ui.selectiontv

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.fragment.app.Fragment
import androidx.fragment.compose.content
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.jellyfin.androidtv.ui.navigation.Destinations
import org.jellyfin.androidtv.ui.navigation.NavigationRepository
import org.jellyfin.androidtv.ui.search.SearchRepository
import org.jellyfin.androidtv.ui.shared.toolbar.MainToolbar
import org.jellyfin.androidtv.ui.shared.toolbar.MainToolbarActiveButton
import org.jellyfin.sdk.api.client.ApiClient
import org.jellyfin.sdk.api.client.extensions.itemsApi
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.BaseItemKind
import org.jellyfin.sdk.model.api.ItemFields
import org.json.JSONObject
import org.koin.android.ext.android.inject
import java.text.Normalizer
import java.util.UUID

class SelectionTvFragment : Fragment() {
	private val api by inject<ApiClient>()
	private val navigationRepository by inject<NavigationRepository>()
	private val searchRepository by inject<SearchRepository>()
	private val indexMutex = Mutex()

	private var webView: WebView? = null

	@Volatile
	private var libraryIndex: List<BaseItemDto>? = null

	private data class LookupRequest(
		val key: String,
		val title: String,
		val year: Int?,
		val imdbId: String?,
		val tmdbId: String?,
		val aliases: List<String> = emptyList(),
	)

	private inner class SelectionTvJavascriptBridge {
		@JavascriptInterface
		fun isLibraryReady(): Boolean = libraryIndex != null

		@JavascriptInterface
		fun lookupQuick(payload: String) {
			val request = parseLookup(payload) ?: return
			lifecycleScope.launch {
				val item = try {
					withTimeout(QUICK_LOOKUP_TIMEOUT_MS) {
						withContext(Dispatchers.IO) {
							val index = ensureLibraryIndex()
							exactIndexMatch(index, request) ?: conservativeIndexMatch(index, request)
						}
					}
				} catch (timeout: TimeoutCancellationException) {
					deliverResult(JSONObject().apply {
						put("key", request.key)
						put("error", "Vérification Jellyfin expirée.")
						put("errorType", "Timeout")
						put("quick", true)
					}.toString())
					return@launch
				} catch (cancelled: CancellationException) {
					throw cancelled
				} catch (error: Exception) {
					deliverResult(JSONObject().apply {
						put("key", request.key)
						put("error", "Vérification Jellyfin impossible.")
						put("errorType", error.javaClass.simpleName)
						put("quick", true)
					}.toString())
					return@launch
				}

				deliverResult(JSONObject().apply {
					put("key", request.key)
					put("found", item != null)
					put("quick", true)
					put("libraryCount", libraryIndex?.size ?: 0)
					if (item != null) {
						put("itemId", item.id.toString())
						put("name", item.name ?: "")
					}
				}.toString())
			}
		}

		@JavascriptInterface
		fun lookup(payload: String) {
			val request = parseLookup(payload) ?: return
			lifecycleScope.launch {
				val item = try {
					withTimeout(LOOKUP_TIMEOUT_MS) {
						withContext(Dispatchers.IO) { findLibraryItem(request) }
					}
				} catch (timeout: TimeoutCancellationException) {
					deliverResult(JSONObject().apply {
						put("key", request.key)
						put("error", "La recherche Jellyfin a expiré. Réessayez.")
						put("errorType", "Timeout")
					}.toString())
					return@launch
				} catch (cancelled: CancellationException) {
					throw cancelled
				} catch (error: Exception) {
					deliverResult(JSONObject().apply {
						put("key", request.key)
						put("error", "Recherche Jellyfin impossible. Vérifiez la connexion au serveur, puis réessayez.")
						put("errorType", error.javaClass.simpleName)
					}.toString())
					return@launch
				}
				val result = JSONObject().apply {
					put("key", request.key)
					put("found", item != null)
					put("libraryCount", libraryIndex?.size ?: 0)
					if (item != null) {
						put("itemId", item.id.toString())
						put("name", item.name ?: "")
					}
				}
				deliverResult(result.toString())
			}
		}

		@JavascriptInterface
		fun openItem(itemId: String) {
			val id = runCatching { UUID.fromString(itemId) }.getOrNull() ?: return
			activity?.runOnUiThread {
				navigationRepository.navigate(Destinations.itemDetails(id))
			}
		}
	}

	@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
	override fun onCreateView(
		inflater: LayoutInflater,
		container: ViewGroup?,
		savedInstanceState: Bundle?,
	) = content {
		Column(
			modifier = Modifier.fillMaxSize(),
		) {
			MainToolbar(MainToolbarActiveButton.SelectionTv)

			AndroidView(
				modifier = Modifier.fillMaxSize(),
				factory = { context ->
					WebView(context).also { view ->
						webView = view
						view.isFocusable = true
						view.isFocusableInTouchMode = true
						view.settings.javaScriptEnabled = true
						view.settings.domStorageEnabled = true
						view.settings.cacheMode = WebSettings.LOAD_NO_CACHE
						view.settings.mediaPlaybackRequiresUserGesture = true
						view.settings.useWideViewPort = true
						view.settings.loadWithOverviewMode = true
						view.settings.setSupportMultipleWindows(false)
						view.addJavascriptInterface(SelectionTvJavascriptBridge(), JS_BRIDGE_NAME)
						view.webViewClient = object : WebViewClient() {
							override fun shouldOverrideUrlLoading(
								view: WebView?,
								request: WebResourceRequest?,
							): Boolean {
								val uri = request?.url ?: return true
								if (uri.scheme == SELECTION_TV_SCHEME && uri.host == "open") {
									handleOpenCommand(uri)
									return true
								}
								return !isAllowedSelectionTvUrl(uri)
							}
						}
						view.webChromeClient = WebChromeClient()
						view.setOnKeyListener { _, keyCode, event ->
							if (event.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener false

							val command = when (keyCode) {
								KeyEvent.KEYCODE_DPAD_UP -> "up"
								KeyEvent.KEYCODE_DPAD_DOWN -> "down"
								KeyEvent.KEYCODE_DPAD_LEFT -> "left"
								KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
								KeyEvent.KEYCODE_DPAD_CENTER,
								KeyEvent.KEYCODE_ENTER,
								KeyEvent.KEYCODE_NUMPAD_ENTER,
								KeyEvent.KEYCODE_BUTTON_A -> "activate"
								else -> null
							} ?: return@setOnKeyListener false

							// Fire TV emits repeated ACTION_DOWN events while a direction is held.
							// Consume those repeats instead of turning one press into several jumps.
							if (event.repeatCount > 0) return@setOnKeyListener true

							view.evaluateJavascript(
								"window.SelectionTvTvRemote && window.SelectionTvTvRemote('$command');",
								null,
							)
							true
						}
						view.loadUrl(SELECTION_TV_URL)
						view.post {
							view.requestFocus()
						}

						// Mirror the browser integration: build the compact provider/title
						// index once in the background so exact IMDb/TMDb matches are ready
						// before the user opens a card.
						lifecycleScope.launch(Dispatchers.IO) {
							runCatching { ensureLibraryIndex() }
								.onSuccess { deliverLibraryReady(it.size) }
						}
					}
				},
			)
		}
	}

	private fun handleOpenCommand(uri: Uri) {
		val request = LookupRequest(
			key = uri.getQueryParameter("key").orEmpty(),
			title = uri.getQueryParameter("title").orEmpty(),
			year = uri.getQueryParameter("year")?.toIntOrNull(),
			imdbId = uri.getQueryParameter("imdbId")?.takeIf { it.isNotBlank() },
			tmdbId = uri.getQueryParameter("tmdbId")?.takeIf { it.isNotBlank() },
			aliases = uri.getQueryParameter("aliases")
				.orEmpty()
				.split("\n")
				.map { it.trim() }
				.filter { it.isNotBlank() },
		).takeIf { it.key.isNotBlank() && it.title.isNotBlank() } ?: return

		lifecycleScope.launch {
			val item = try {
				withTimeout(LOOKUP_TIMEOUT_MS) {
					withContext(Dispatchers.IO) { findLibraryItemForOpen(request) }
				}
			} catch (timeout: TimeoutCancellationException) {
				deliverOpenResult(
					JSONObject().apply {
						put("key", request.key)
						put("error", true)
						put("errorType", "Timeout")
					}.toString()
				)
				return@launch
			} catch (cancelled: CancellationException) {
				throw cancelled
			} catch (error: Exception) {
				deliverOpenResult(
					JSONObject().apply {
						put("key", request.key)
						put("error", true)
						put("errorType", error.javaClass.simpleName)
					}.toString()
				)
				return@launch
			}

			if (item != null) {
				deliverOpenResult(
					JSONObject().apply {
						put("key", request.key)
						put("found", true)
						put("itemId", item.id.toString())
					}.toString()
				)
				navigationRepository.navigate(Destinations.itemDetails(item.id))
			} else {
				deliverOpenResult(
					JSONObject().apply {
						put("key", request.key)
						put("found", false)
					}.toString()
				)
			}
		}
	}

	private fun parseLookup(payload: String): LookupRequest? = runCatching {
		val json = JSONObject(payload)
		val title = json.optString("title").trim()
		val key = json.optString("key").trim()
		if (title.isEmpty() || key.isEmpty()) return null

		val aliases = buildList {
			val array = json.optJSONArray("aliases")
			if (array != null) {
				for (index in 0 until array.length()) {
					val value = array.optString(index).trim()
					if (value.isNotBlank()) add(value)
				}
			}
		}

		LookupRequest(
			key = key,
			title = title,
			year = json.optString("year").toIntOrNull(),
			imdbId = json.optString("imdbId").takeIf { it.isNotBlank() },
			tmdbId = json.optString("tmdbId").takeIf { it.isNotBlank() },
			aliases = aliases,
		)
	}.getOrNull()

	private suspend fun ensureLibraryIndex(): List<BaseItemDto> {
		libraryIndex?.let { return it }

		return indexMutex.withLock {
			libraryIndex?.let { return@withLock it }

			val all = mutableListOf<BaseItemDto>()
			val seen = mutableSetOf<UUID>()
			var startIndex = 0
			var expectedTotal = 0

			while (startIndex < MAX_LIBRARY_ITEMS) {
				val result = api.itemsApi.getItems(
					recursive = true,
					includeItemTypes = setOf(BaseItemKind.MOVIE, BaseItemKind.SERIES, BaseItemKind.VIDEO, BaseItemKind.EPISODE),
					fields = setOf(
						ItemFields.PROVIDER_IDS,
						ItemFields.ORIGINAL_TITLE,
					),
					startIndex = startIndex,
					limit = LIBRARY_PAGE_SIZE,
					enableImages = false,
					enableUserData = false,
					enableTotalRecordCount = true,
				).content

				val batch = result.items
				if (batch.isEmpty()) break

				var added = 0
				for (item in batch) {
					if (seen.add(item.id)) {
						all += item
						added++
					}
				}

				startIndex += batch.size
				expectedTotal = result.totalRecordCount
				if (expectedTotal > 0 && startIndex >= expectedTotal) break
				if (added == 0) break
				if (expectedTotal <= 0 && batch.size < LIBRARY_PAGE_SIZE) break
			}

			all.also { libraryIndex = it }
		}
	}

	private suspend fun findLibraryItem(request: LookupRequest): BaseItemDto? {
		// Same order as the browser bridge that is already reliable:
		// 1) compact library index, exact provider IDs first;
		// 2) exact title/original-title (+ year disambiguation);
		// 3) conservative targeted Jellyfin search.
		val index = ensureLibraryIndex()
		exactIndexMatch(index, request)?.let { return it }
		conservativeIndexMatch(index, request)?.let { return it }
		return fallbackSearch(request)
	}

	private suspend fun findLibraryItemForOpen(request: LookupRequest): BaseItemDto? {
		// The UI may hold a positive match for 30 days. Replacing a media file
		// can give the same movie a new Jellyfin UUID, so never navigate from a
		// stale index entry without checking that UUID still exists server-side.
		val currentIndex = ensureLibraryIndex()
		val indexed = exactIndexMatch(currentIndex, request)
			?: conservativeIndexMatch(currentIndex, request)

		if (indexed != null) {
			liveItemById(indexed.id)?.let { return it }

			// The old UUID disappeared (typical remove + re-add / quality upgrade).
			// Rebuild the index now, then resolve the same editorial work again.
			val refreshed = refreshLibraryIndex()
			exactIndexMatch(refreshed, request)?.let { return it }
			conservativeIndexMatch(refreshed, request)?.let { return it }
			return fallbackSearch(request)
		}

		// No hit in the snapshot. The library may have changed since this
		// fragment was opened, so refresh once before falling back to search.
		val refreshed = refreshLibraryIndex()
		exactIndexMatch(refreshed, request)?.let { return it }
		conservativeIndexMatch(refreshed, request)?.let { return it }
		return fallbackSearch(request)
	}

	private suspend fun liveItemById(id: UUID): BaseItemDto? = runCatching {
		api.itemsApi.getItems(
			ids = setOf(id),
			fields = setOf(
				ItemFields.PROVIDER_IDS,
				ItemFields.ORIGINAL_TITLE,
			),
			limit = 1,
			enableImages = false,
			enableUserData = false,
			enableTotalRecordCount = false,
		).content.items.firstOrNull { it.id == id }
	}.getOrNull()

	private suspend fun refreshLibraryIndex(): List<BaseItemDto> {
		indexMutex.withLock {
			libraryIndex = null
		}
		return ensureLibraryIndex()
	}

	private fun exactIndexMatch(
		items: Collection<BaseItemDto>,
		request: LookupRequest,
	): BaseItemDto? {
		val reqImdb = request.imdbId?.lowercase().orEmpty()
		val reqTmdb = request.tmdbId.orEmpty()

		if (reqImdb.isNotBlank()) {
			items.firstOrNull { item ->
				providerId(item, "imdb").lowercase() == reqImdb
			}?.let { return it }
		}

		if (reqTmdb.isNotBlank()) {
			items.firstOrNull { item ->
				providerId(item, "tmdb") == reqTmdb
			}?.let { return it }
		}

		val targetNames = requestTitleCandidates(request)
			.map(::normalizeTitle)
			.filter { it.isNotBlank() }
			.toSet()

		val candidates = items.filter { item ->
			itemNames(item).any { normalizeTitle(it) in targetNames }
		}

		if (candidates.isEmpty()) return null

		val reqYear = request.year
		if (reqYear != null) {
			candidates.firstOrNull { it.productionYear == reqYear }?.let { return it }

			val near = candidates.filter { item ->
				item.productionYear?.let { kotlin.math.abs(it - reqYear) <= 1 } == true
			}
			if (near.size == 1) return near.first()
			return null
		}

		return candidates.singleOrNull()
	}

	private fun conservativeIndexMatch(
		items: Collection<BaseItemDto>,
		request: LookupRequest,
	): BaseItemDto? {
		val targets = requestTitleCandidates(request)
			.map(::normalizeTitle)
			.filter { it.isNotBlank() }

		val candidates = items.filter { item ->
			itemNames(item)
				.map(::normalizeTitle)
				.any { name -> targets.any { target -> strongTitleContainment(name, target) } }
		}

		if (candidates.isEmpty()) return null

		val reqYear = request.year
		if (reqYear != null) {
			val exactYear = candidates.filter { it.productionYear == reqYear }
			if (exactYear.size == 1) return exactYear.first()

			val nearYear = candidates.filter { item ->
				item.productionYear?.let { kotlin.math.abs(it - reqYear) <= 1 } == true
			}
			if (nearYear.size == 1) return nearYear.first()

			// Metadata for obscure TV documentaries is often missing a year in
			// Jellyfin. A single distinctive long-title candidate is still safe.
			if (candidates.size == 1 && candidates.first().productionYear == null) {
				return candidates.first()
			}
			return null
		}

		return candidates.singleOrNull()
	}

	private fun strongTitleContainment(left: String, right: String): Boolean {
		if (left == right) return true
		val shorter = if (left.length <= right.length) left else right
		val longer = if (left.length > right.length) left else right
		val tokenCount = shorter.split(" ").count { it.isNotBlank() }
		if (shorter.length < 14 || tokenCount < 3) return false
		return longer.startsWith("$shorter ") ||
			longer.endsWith(" $shorter") ||
			longer.contains(" $shorter ")
	}

	private suspend fun fallbackSearch(request: LookupRequest): BaseItemDto? {
		val all = linkedMapOf<UUID, BaseItemDto>()
		var successfulSearches = 0

		for (term in requestTitleCandidates(request).take(MAX_SEARCH_TERMS)) {
			// Mirror the Jellyfin Web bridge instead of routing through
			// SearchRepository. The latter has a special "Video" request shape
			// that excludes some video item kinds and made one-off TV
			// documentaries behave differently on Android TV.
			runCatching {
				api.itemsApi.getItems(
					recursive = true,
					includeItemTypes = setOf(
						BaseItemKind.MOVIE,
						BaseItemKind.SERIES,
						BaseItemKind.VIDEO,
						BaseItemKind.EPISODE,
					),
					searchTerm = term,
					fields = setOf(
						ItemFields.PROVIDER_IDS,
						ItemFields.ORIGINAL_TITLE,
					),
					limit = FALLBACK_SEARCH_LIMIT,
					enableImages = false,
					enableUserData = false,
					enableTotalRecordCount = false,
				).content.items
			}.getOrNull()?.let { items ->
				successfulSearches++
				items.forEach { all[it.id] = it }
			}
		}

		if (successfulSearches == 0) return null

		return all.values
			.map { item -> item to browserStyleScore(item, request) }
			.maxByOrNull { it.second }
			?.takeIf { it.second >= FALLBACK_MATCH_THRESHOLD }
			?.first
	}

	private fun browserStyleScore(item: BaseItemDto, request: LookupRequest): Int {
		var score = 0
		val targetNames = requestTitleCandidates(request).map(::normalizeTitle)
		val names = itemNames(item).map(::normalizeTitle)
		val itemYear = item.productionYear
		val reqYear = request.year
		val itemImdb = providerId(item, "imdb").lowercase()
		val itemTmdb = providerId(item, "tmdb")

		if (!request.imdbId.isNullOrBlank() && itemImdb.isNotBlank() &&
			itemImdb == request.imdbId.lowercase()
		) score += 1000

		if (!request.tmdbId.isNullOrBlank() && itemTmdb.isNotBlank() &&
			itemTmdb == request.tmdbId
		) score += 900

		targetNames.forEachIndexed { index, target ->
			score = when {
				names.contains(target) -> maxOf(score, 160 - index * 8)
				names.any { strongTitleContainment(it, target) } ->
					maxOf(score, 155 - index * 5)
				names.any { it.contains(target) || target.contains(it) } ->
					maxOf(score, 55 - index * 5)
				else -> score
			}
		}

		if (reqYear != null && itemYear == reqYear) score += 60
		else if (reqYear != null && itemYear != null && kotlin.math.abs(itemYear - reqYear) <= 1) score += 10

		return score
	}

	private fun providerId(item: BaseItemDto, key: String): String =
		item.providerIds.orEmpty().entries
			.firstOrNull { it.key.equals(key, ignoreCase = true) }
			?.value
			.orEmpty()

	private fun itemNames(item: BaseItemDto): List<String> =
		listOfNotNull(item.name, item.originalTitle).filter { it.isNotBlank() }

	private fun requestTitleCandidates(request: LookupRequest): List<String> =
		linkedSetOf<String>().apply {
			addAll(titleCandidates(request.title))
			request.aliases.forEach { alias -> addAll(titleCandidates(alias)) }
		}.take(MAX_SEARCH_TERMS)

	private fun titleCandidates(title: String): List<String> {
		val raw = title.trim()
		val out = linkedSetOf<String>()

		fun add(value: String) {
			val cleaned = value.replace(Regex("\\s+"), " ").trim()
			if (cleaned.isNotBlank()) out += cleaned
		}

		add(raw)

		Regex("\\(([^()]{2,100})\\)")
			.findAll(raw)
			.map { it.groupValues[1] }
			.forEach(::add)

		add(raw.replace(Regex("\\s*\\([^()]+\\)\\s*"), " ").replace(Regex("\\s+"), " "))

		if (Regex("\\s+-\\s+").containsMatchIn(raw)) {
			add(raw.split(Regex("\\s+-\\s+"), limit = 2).first())
		}

		return out.take(3)
	}

	private fun normalizeTitle(value: String): String {
		var text = Normalizer.normalize(value.lowercase(), Normalizer.Form.NFD)
			.replace(Regex("\\p{Mn}+"), "")
			.replace(Regex("[^a-z0-9]+"), " ")
			.trim()
			.replace(Regex("\\s+"), " ")

		text = text
			.replace(Regex("\\bmr\\b"), "mister")
			.replace(Regex("\\bmrs\\b"), "missus")
			.replace(Regex("\\bdr\\b"), "doctor")

		return text
	}

	private fun deliverLibraryReady(count: Int) {
		val script = "window.SelectionTvAndroidLibraryReady && window.SelectionTvAndroidLibraryReady($count);"
		webView?.post {
			webView?.evaluateJavascript(script, null)
		}
	}

	private fun deliverResult(json: String) {
		val script = "window.SelectionTvAndroidResult && window.SelectionTvAndroidResult($json);"
		webView?.post {
			webView?.evaluateJavascript(script, null)
		}
	}

	private fun deliverOpenResult(json: String) {
		val script = "window.SelectionTvAndroidOpenResult && window.SelectionTvAndroidOpenResult($json);"
		webView?.post {
			webView?.evaluateJavascript(script, null)
		}
	}

	private fun isAllowedSelectionTvUrl(uri: Uri): Boolean =
		uri.scheme == "https" &&
			uri.host == "kingrabbit89.github.io" &&
			(uri.path ?: "").startsWith("/selection-tv/")

	override fun onDestroyView() {
		webView?.apply {
			removeJavascriptInterface(JS_BRIDGE_NAME)
			stopLoading()
			loadUrl("about:blank")
			destroy()
		}
		webView = null
		super.onDestroyView()
	}

	private companion object {
		const val JS_BRIDGE_NAME = "SelectionTvAndroid"
		const val SELECTION_TV_SCHEME = "selectiontv"
		const val SELECTION_TV_URL = "https://kingrabbit89.github.io/selection-tv/latest.html?tv=1"
		const val LIBRARY_PAGE_SIZE = 200
		const val MAX_LIBRARY_ITEMS = 50_000
		const val MATCH_THRESHOLD = 300
		const val FALLBACK_MATCH_THRESHOLD = 150
		const val FALLBACK_SEARCH_LIMIT = 25
		const val MAX_SEARCH_TERMS = 6
		const val LOOKUP_TIMEOUT_MS = 15_000L
		const val QUICK_LOOKUP_TIMEOUT_MS = 8_000L
	}
}
