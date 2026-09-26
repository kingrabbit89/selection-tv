package org.jellyfin.androidtv.ui.selectiontv

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.fragment.app.Fragment
import androidx.fragment.compose.content
import org.jellyfin.androidtv.ui.shared.toolbar.MainToolbar
import org.jellyfin.androidtv.ui.shared.toolbar.MainToolbarActiveButton

class SelectionTvFragment : Fragment() {
	private var webView: WebView? = null

	@SuppressLint("SetJavaScriptEnabled")
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
						view.settings.cacheMode = WebSettings.LOAD_DEFAULT
						view.settings.mediaPlaybackRequiresUserGesture = true
						view.settings.useWideViewPort = true
						view.settings.loadWithOverviewMode = true
						view.webViewClient = WebViewClient()
						view.webChromeClient = WebChromeClient()
						view.loadUrl(SELECTION_TV_URL)
					}
				},
			)
		}
	}

	override fun onDestroyView() {
		webView?.apply {
			stopLoading()
			loadUrl("about:blank")
			destroy()
		}
		webView = null
		super.onDestroyView()
	}

	private companion object {
		const val SELECTION_TV_URL = "https://kingrabbit89.github.io/selection-tv/latest.html"
	}
}
