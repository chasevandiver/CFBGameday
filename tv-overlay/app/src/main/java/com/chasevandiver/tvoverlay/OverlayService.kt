package com.chasevandiver.tvoverlay

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Owns the overlay window and the phone control server. Runs as a foreground
 * service so Fire OS's low-memory killer leaves it alone while a show plays.
 */
class OverlayService : Service() {

    companion object {
        const val PORT = 7979
        const val ACTION_START = "start"
        const val ACTION_SHOW_PRESET = "show_preset"
        const val ACTION_HIDE = "hide"
        const val EXTRA_INDEX = "index"

        @Volatile
        var instance: OverlayService? = null
            private set

        fun send(ctx: Context, action: String = ACTION_START, index: Int = -1) {
            val i = Intent(ctx, OverlayService::class.java).setAction(action).putExtra(EXTRA_INDEX, index)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun canDraw(ctx: Context): Boolean =
            Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)
    }

    lateinit var store: Store
        private set

    private lateinit var wm: WindowManager
    private val main = Handler(Looper.getMainLooper())
    private var server: ControlServer? = null
    private var frame: FrameLayout? = null
    private var web: WebView? = null
    private var ticker: TickerView? = null
    private var loadedUrl: String? = null
    private var loadedNative = false
    private var driftStep = 0

    @Volatile
    var lastError: String? = null
        private set

    private val retry = Runnable { web?.reload() }

    /** The Slate's own ticker is drawn natively (TV-7); anything else is a web page. */
    private fun isNativeTicker(c: OverlayConfig): Boolean = c.layout == "ticker" && try {
        java.net.URL(c.url).path.trimEnd('/') == "/tv/ticker"
    } catch (_: Exception) {
        false
    }
    private val hourlyReload = object : Runnable {
        override fun run() {
            web?.reload()
            main.postDelayed(this, 60 * 60 * 1000L)
        }
    }

    /* Burn-in guard: a static strip on an OLED for a whole Saturday leaves a
       ghost. Nudge the window a few pixels every two minutes. */
    private val drift = object : Runnable {
        override fun run() {
            driftStep = (driftStep + 1) % DRIFT.size
            if (frame != null) applyConfig()
            main.postDelayed(this, 2 * 60 * 1000L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        store = Store(this)
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        startForegroundCompat()
        server = ControlServer(this, PORT).also { it.start() }
        main.postDelayed(drift, 2 * 60 * 1000L)
        main.postDelayed(hourlyReload, 60 * 60 * 1000L)
        if (store.config.visible) applyConfig()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_SHOW_PRESET -> {
                val idx = intent.getIntExtra(EXTRA_INDEX, 0)
                store.presets.optJSONObject(idx)?.let { show(it) }
            }
            ACTION_HIDE -> hide()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        server?.stop()
        main.removeCallbacksAndMessages(null)
        removeOverlay()
        instance = null
        super.onDestroy()
    }

    // ── Commands (any thread) ────────────────────────────────────────────────

    fun show(fields: JSONObject) = onMain {
        store.update { it.merge(fields).copy(visible = true) }
        applyConfig()
    }

    fun hide() = onMain {
        store.update { it.copy(visible = false) }
        applyConfig()
    }

    fun reloadPage() = onMain { web?.reload() }

    fun savePresets(list: JSONArray) = store.savePresets(list)

    fun state(): JSONObject = store.config.toJson()
        .put("presets", store.presets)
        .put("canDraw", canDraw(this))
        .put("error", lastError ?: JSONObject.NULL)
        .put("ip", Net.localIp() ?: JSONObject.NULL)
        .put("port", PORT)
        .put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        .put("version", packageManager.getPackageInfo(packageName, 0).versionName)

    /** Runs on the UI thread and waits for it, so the HTTP reply reflects it. */
    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block(); return
        }
        val done = CountDownLatch(1)
        main.post {
            try { block() } finally { done.countDown() }
        }
        done.await(4, TimeUnit.SECONDS)
    }

    // ── Window ───────────────────────────────────────────────────────────────

    private fun applyConfig() {
        val c = store.config
        if (!c.visible) {
            removeOverlay(); return
        }
        if (!canDraw(this)) {
            lastError = "Overlay permission isn't granted yet. Open TV Overlay on the TV and pick Grant permission."
            return
        }
        lastError = null
        val params = layoutParams(c)

        val native = isNativeTicker(c)
        // A different page, or a switch between web and native, rebuilds the
        // window's content; a move or resize only updates the layout.
        if (frame != null && (loadedUrl != c.url || loadedNative != native)) removeOverlay()

        if (frame == null) {
            val f = FrameLayout(this).apply {
                clipChildren = true
                setBackgroundColor(Color.TRANSPARENT)
            }
            val content: View = if (native) TickerView(this, c.url) else makeWebView()
            f.addView(content)
            try {
                wm.addView(f, params)
            } catch (e: Exception) {
                lastError = "The TV refused to draw over other apps (${e.message})."
                (content as? WebView)?.destroy()
                return
            }
            frame = f
            if (content is WebView) {
                web = content
                content.loadUrl(c.url)
            } else {
                ticker = content as TickerView
            }
            loadedUrl = c.url
            loadedNative = native
        } else {
            wm.updateViewLayout(frame, params)
        }
        frame?.alpha = c.opacity / 100f

        ticker?.layoutParams = FrameLayout.LayoutParams(params.width, params.height)
        val wv = web ?: return
        val z = c.zoom / 100f
        wv.layoutParams = FrameLayout.LayoutParams((params.width / z).toInt(), (params.height / z).toInt())
        wv.pivotX = 0f
        wv.pivotY = 0f
        wv.scaleX = z
        wv.scaleY = z
    }

    private fun layoutParams(c: OverlayConfig): WindowManager.LayoutParams {
        val m = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(m)
        val sw = m.widthPixels
        val sh = m.heightPixels

        val type = if (Build.VERSION.SDK_INT >= 26) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        // Never focusable or touchable: every remote press goes to the show.
        val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED

        val (dx, dy) = DRIFT[driftStep]

        val w: Int
        val h: Int
        val gravity: Int
        val x: Int
        val y: Int
        if (c.layout == "ticker") {
            // Flush to the very top or bottom edge, full width (TV-6). Heights
            // stay inside the bottom 5% that broadcasters keep clear of their
            // score bugs (title-safe), so the strip sits under the game's own
            // scoreboard. Large trades a little of that margin for size.
            w = sw
            h = (sh * when (c.size) { "s" -> 0.038f; "l" -> 0.058f; else -> 0.046f }).toInt()
            gravity = (if (c.position == "top") Gravity.TOP else Gravity.BOTTOM) or Gravity.START
            // No window drift: it would open a gap at the edge. The crawl moves
            // anyway, and the page nudges its one static label itself.
            x = 0
            y = 0
        } else {
            // TVs crop the picture edge (overscan); the box stays inside the safe area.
            val mx = (sw * 0.035f).toInt()
            val my = (sh * 0.045f).toInt()
            // Sized up for the couch: the box's width is what sets the text size.
            w = (sw * when (c.size) { "s" -> 0.28f; "l" -> 0.42f; else -> 0.34f }).toInt()
            h = (w * 0.75f).toInt()
            gravity = when (c.position) {
                "tl" -> Gravity.TOP or Gravity.START
                "bl" -> Gravity.BOTTOM or Gravity.START
                "br" -> Gravity.BOTTOM or Gravity.END
                else -> Gravity.TOP or Gravity.END
            }
            x = mx + dx
            y = my + dy
        }

        return WindowManager.LayoutParams(w, h, type, flags, PixelFormat.TRANSLUCENT).also {
            it.gravity = gravity
            it.x = x
            it.y = y
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun makeWebView(): WebView = WebView(this).apply {
        setBackgroundColor(Color.TRANSPARENT)
        // No hardware layer: the page animates every frame, so a layer would be
        // re-rendered every frame and then composited again. Stutters on TVs.
        isFocusable = false
        isFocusableInTouchMode = false
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.userAgentString = settings.userAgentString + " TVOverlay/1"
        webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    main.removeCallbacks(retry)
                    main.postDelayed(retry, 30_000)
                }
            }
        }
    }

    private fun removeOverlay() {
        val f = frame ?: return
        try { wm.removeView(f) } catch (_: Exception) { }
        web?.destroy()
        frame = null
        web = null
        ticker = null
        loadedUrl = null
    }

    private fun startForegroundCompat() {
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel("overlay", "Overlay", NotificationManager.IMPORTANCE_MIN),
            )
            Notification.Builder(this, "overlay")
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val n = builder
            .setContentTitle("TV Overlay")
            .setContentText("Phone control on port $PORT")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .build()
        startForeground(1, n)
    }
}

private val DRIFT = listOf(0 to 0, 6 to 3, -3 to 7, 5 to -4, -6 to -2, 2 to 5)
