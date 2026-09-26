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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.jellyfin.androidtv.auth.repository.SessionRepository
import org.jellyfin.androidtv.ui.navigation.Destinations
import org.jellyfin.androidtv.ui.navigation.NavigationRepository
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
	private val sessionRepository by inject<SessionRepository>()
	private val navigationRepository by inject<NavigationRepository>()
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
	)

	private inner class SelectionTvJavascriptBridge {
		@JavascriptInterface
		fun lookup(payload: String) {
			val request = parseLookup(payload) ?: return
			lifecycleScope.launch {
				val item = try {
					withContext(Dispatchers.IO) { findLibraryItem(request) }
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
		).takeIf { it.key.isNotBlank() && it.title.isNotBlank() } ?: return

		lifecycleScope.launch {
			val item = try {
				withContext(Dispatchers.IO) { findLibraryItem(request) }
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

		LookupRequest(
			key = key,
			title = title,
			year = json.optString("year").toIntOrNull(),
			imdbId = json.optString("imdbId").takeIf { it.isNotBlank() },
			tmdbId = json.optString("tmdbId").takeIf { it.isNotBlank() },
		)
	}.getOrNull()

	private fun currentUserId(): UUID = checkNotNull(sessionRepository.currentSession.value?.userId) {
		"No active Jellyfin session"
	}

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
					userId = currentUserId(),
					recursive = true,
					includeItemTypes = setOf(BaseItemKind.MOVIE, BaseItemKind.SERIES),
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
		val items = ensureLibraryIndex()
		bestMatch(items, request, MATCH_THRESHOLD)?.let { return it }

		// Fallback for titles that differ from Jellyfin's local/original title.
		// This runs only when the compact full-library index could not identify the work.
		val search = api.itemsApi.getItems(
			userId = currentUserId(),
			searchTerm = request.title,
			recursive = true,
			includeItemTypes = setOf(BaseItemKind.MOVIE, BaseItemKind.SERIES),
			fields = setOf(
				ItemFields.PROVIDER_IDS,
				ItemFields.ORIGINAL_TITLE,
			),
			limit = 20,
			enableImages = false,
			enableUserData = false,
			enableTotalRecordCount = false,
		).content

		return bestMatch(search.items, request, FALLBACK_MATCH_THRESHOLD)
	}

	private fun bestMatch(
		items: Collection<BaseItemDto>,
		request: LookupRequest,
		threshold: Int,
	): BaseItemDto? {
		var best: BaseItemDto? = null
		var bestScore = Int.MIN_VALUE

		for (item in items) {
			val score = score(item, request)
			if (score > bestScore) {
				best = item
				bestScore = score
			}
		}

		return best?.takeIf { bestScore >= threshold }
	}

	private fun score(item: BaseItemDto, request: LookupRequest): Int {
		val providers = item.providerIds.orEmpty()
		val imdb = providers.entries.firstOrNull { it.key.equals("imdb", ignoreCase = true) }?.value
		val tmdb = providers.entries.firstOrNull { it.key.equals("tmdb", ignoreCase = true) }?.value

		if (!request.imdbId.isNullOrBlank() && imdb.equals(request.imdbId, ignoreCase = true)) return 10_000
		if (!request.tmdbId.isNullOrBlank() && tmdb == request.tmdbId) return 9_000

		val wanted = normalizeTitle(request.title)
		if (wanted.isEmpty()) return Int.MIN_VALUE

		val names = listOfNotNull(item.name, item.originalTitle)
			.map(::normalizeTitle)
			.filter { it.isNotEmpty() }

		var score = when {
			names.any { it == wanted } -> 300
			names.any { it.contains(wanted) || wanted.contains(it) } -> 150
			else -> 0
		}

		val requestYear = request.year
		val itemYear = item.productionYear
		if (requestYear != null && itemYear != null) {
			score += when {
				requestYear == itemYear -> 80
				kotlin.math.abs(requestYear - itemYear) == 1 -> 15
				else -> -80
			}
		}

		return score
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
	}
}
