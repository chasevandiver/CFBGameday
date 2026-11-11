package com.chasevandiver.tvoverlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.View
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.floor

/**
 * The CFB Slate ticker drawn natively (TV-7).
 *
 * The web page's CSS crawl stuttered on real Fire TVs: a WebView in an overlay
 * window, over playing video, drops frames. This view reads the same
 * /api/ticker feed and draws the same chips with Canvas, positioning the crawl
 * from the frame clock so speed stays even when a frame is late.
 *
 * Rules mirror src/components/tv/TvChip.tsx; keep them in step:
 * order (live, upcoming, final; viewer's games first in each), status text,
 * the line (viewer's ticket, else favourite-first market spread), and colour
 * (the team the viewer is on takes the verdict; totals colour the line).
 */
@SuppressLint("ViewConstructor")
class TickerView(context: Context, pageUrl: String) : View(context) {

    private val apiUrl: String = run {
        val u = URL(pageUrl)
        val k = u.query?.split("&")?.firstOrNull { it.startsWith("k=") }?.removePrefix("k=")
        "${u.protocol}://${u.authority}/api/ticker" + (if (k.isNullOrBlank()) "" else "?k=$k")
    }

    private data class Seg(val text: String, val paint: Paint, val gapBefore: Float, val dot: Boolean = false)
    private class Chip(val segs: List<Seg>, val width: Float)

    @Volatile private var chips: List<Chip> = emptyList()
    private var week: String = ""
    private var contentWidth = 0f
    private var anyLive = false
    private var loaded = false

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    // ── Paints (sized in onSizeChanged) ─────────────────────────────────────
    private val condensedBold = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val condensed = Typeface.create("sans-serif-condensed", Typeface.NORMAL)
    private val mono = Typeface.MONOSPACE

    private fun paint(color: Int, tf: Typeface) = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        this.color = color
        typeface = tf
    }

    private val pBrand = paint(ACCENT, condensedBold).apply { letterSpacing = 0.08f }
    private val pWeek = paint(DIM, condensed)
    private val pTeamLead = paint(CHALK, condensedBold)
    private val pTeam = paint(CHALK, condensed)
    private val pTeamTrail = paint(CHALK_45, condensed)
    private val pTeamTrailBold = paint(CHALK_45, condensedBold)
    private val pWin = paint(WIN, condensed)
    private val pWinBold = paint(WIN, condensedBold)
    private val pLoss = paint(LOSS, condensed)
    private val pLossBold = paint(LOSS, condensedBold)
    private val pPush = paint(ACCENT, condensed)
    private val pPushBold = paint(ACCENT, condensedBold)
    private val pLineMine = paint(CHALK, mono)
    private val pLineMarket = paint(CHALK_40, mono)
    private val pLineWin = paint(WIN, mono)
    private val pLineLoss = paint(LOSS, mono)
    private val pLinePush = paint(ACCENT, mono)
    private val pStatusLive = paint(LIVE, mono)
    private val pStatus = paint(DIM, mono)
    private val pTag = paint(CHALK_45, condensed)
    private val pEmpty = paint(DIM, condensed)
    private val pDot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = LIVE }
    private val pBg = Paint().apply { color = PANEL }
    private val pRule = Paint().apply { color = RULE }

    private var unit = 0f        // the team font size; everything scales off it
    private var brandWidth = 0f

    // ── Crawl ───────────────────────────────────────────────────────────────
    private var startNanos = 0L
    private var running = false
    // Vsync timestamp of the frame being drawn: positions step evenly with
    // the display, and a late frame lands where it should, not behind.
    private var frameNanos = 0L
    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!running) return
            if (startNanos == 0L) startNanos = frameTimeNanos
            frameNanos = frameTimeNanos
            invalidate()
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private val poll = object : Runnable {
        override fun run() {
            fetch()
            main.postDelayed(this, if (anyLive) 30_000L else 60_000L)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        main.post(poll)
    }

    override fun onDetachedFromWindow() {
        stopCrawl()
        main.removeCallbacksAndMessages(null)
        io.shutdownNow()
        super.onDetachedFromWindow()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        unit = h * 0.68f
        val secondary = unit * 0.86f
        listOf(pTeamLead, pTeam, pTeamTrail, pTeamTrailBold, pWin, pWinBold, pLoss, pLossBold, pPush, pPushBold)
            .forEach { it.textSize = unit }
        listOf(pLineMine, pLineMarket, pLineWin, pLineLoss, pLinePush, pStatusLive, pStatus)
            .forEach { it.textSize = secondary }
        pBrand.textSize = unit
        pWeek.textSize = unit * 0.6f
        pTag.textSize = unit * 0.55f
        pEmpty.textSize = unit * 0.7f
        brandWidth = unit * 0.6f + pBrand.measureText("THE SLATE") + unit * 0.4f +
            (if (week.isNotEmpty()) pWeek.measureText(week) else 0f) + unit * 0.5f
        rebuild(lastJson)
    }

    // ── Data ────────────────────────────────────────────────────────────────
    private var lastJson: JSONObject? = null

    private fun fetch() {
        io.execute {
            try {
                val conn = URL(apiUrl).openConnection() as HttpURLConnection
                conn.connectTimeout = 8_000
                conn.readTimeout = 8_000
                conn.setRequestProperty("Cache-Control", "no-store")
                val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                val json = JSONObject(body)
                main.post {
                    loaded = true
                    lastJson = json
                    rebuild(json)
                }
            } catch (_: Exception) {
                /* keep what's on screen; the next poll retries */
            }
        }
    }

    private fun rebuild(json: JSONObject?) {
        if (json == null || unit == 0f) {
            invalidate(); return
        }
        week = "WK ${json.optInt("week")}"
        brandWidth = unit * 0.6f + pBrand.measureText("THE SLATE") + unit * 0.4f + pWeek.measureText(week) + unit * 0.5f

        val arr = json.optJSONArray("games")
        val games = (0 until (arr?.length() ?: 0)).mapNotNull { arr?.optJSONObject(it) }
        anyLive = games.any { it.optString("status") == "in_progress" }
        val ordered = games.sortedWith(
            compareBy<JSONObject> { rank(it) }.thenBy { it.optString("startTs") },
        )
        val built = ordered.map { buildChip(it) }
        val oldWidth = contentWidth
        chips = built
        contentWidth = built.sumOf { it.width.toDouble() }.toFloat()

        val viewport = width - brandWidth
        if (contentWidth > viewport) {
            // Keep the crawl's position steady across polls: only a real change
            // in the strip's length (a game added or dropped) resets it.
            if (!running || abs(contentWidth - oldWidth) > oldWidth * 0.25f) startNanos = 0L
            startCrawl()
        } else {
            stopCrawl()
        }
        invalidate()
    }

    private fun rank(g: JSONObject): Int {
        val base = when (g.optString("status")) {
            "in_progress" -> 0
            "scheduled" -> 2
            else -> 4
        }
        return base + if (g.isNull("mine")) 1 else 0
    }

    private fun buildChip(g: JSONObject): Chip {
        val status = g.optString("status")
        val live = status == "in_progress"
        val scored = live || status == "final"
        val home = g.optString("homeAbbr")
        val away = g.optString("awayAbbr")
        val hp = if (g.isNull("homePoints")) 0 else g.optInt("homePoints")
        val ap = if (g.isNull("awayPoints")) 0 else g.optInt("awayPoints")
        val lead = if (!scored || hp == ap) null else if (hp > ap) "home" else "away"
        val mine = if (g.isNull("mine")) null else g.optString("mine")
        val stake = g.optJSONObject("stake")
        val stakeSide = stake?.optString("side")
        val graded = mine == "covering" || mine == "losing" || mine == "push"

        fun teamPaint(side: String): Paint {
            val bold = lead == side
            if (graded && stakeSide == side) {
                return when (mine) {
                    "covering" -> if (bold) pWinBold else pWin
                    "losing" -> if (bold) pLossBold else pLoss
                    else -> if (bold) pPushBold else pPush
                }
            }
            return when {
                lead == null -> pTeam
                lead == side -> pTeamLead
                else -> pTeamTrail
            }
        }

        val segs = mutableListOf<Seg>()
        val gap = unit * 0.32f
        if (live) segs += Seg("", pDot, 0f, dot = true)
        if (g.optString("sport") == "nfl") segs += Seg("NFL", pTag, if (segs.isEmpty()) 0f else gap)
        val pa = teamPaint("away")
        segs += Seg(away, pa, if (segs.isEmpty()) 0f else gap)
        if (scored) segs += Seg("$ap", pa, unit * 0.22f)
        val ph = teamPaint("home")
        segs += Seg(home, ph, gap)
        if (scored) segs += Seg("$hp", ph, unit * 0.22f)

        val line = lineText(g, stake, home, away)
        if (line != null) {
            val total = stakeSide == "over" || stakeSide == "under"
            val p = when {
                graded && total && mine == "covering" -> pLineWin
                graded && total && mine == "losing" -> pLineLoss
                graded && total -> pLinePush
                stake != null -> pLineMine
                else -> pLineMarket
            }
            segs += Seg(line, p, gap * 1.2f)
        }
        segs += Seg(statusText(g), if (live) pStatusLive else pStatus, gap * 1.2f)

        var w = 0f
        for (s in segs) w += s.gapBefore + segWidth(s)
        return Chip(segs, w + unit * 1.4f) // trailing space between games
    }

    private fun segWidth(s: Seg) = if (s.dot) unit * 0.34f else s.paint.measureText(s.text)

    private fun lineText(g: JSONObject, stake: JSONObject?, home: String, away: String): String? {
        if (stake != null) return stake.optString("label")
        if (g.isNull("spread")) return null
        val s = g.optDouble("spread")
        if (s == 0.0) return "PK"
        return if (s < 0) "$home ${num(s)}" else "$away -${num(s)}"
    }

    private fun num(d: Double): String = if (d == floor(d)) d.toLong().toString() else d.toString()

    private fun statusText(g: JSONObject): String {
        when (g.optString("status")) {
            "in_progress" -> {
                val period = if (g.isNull("period")) null else g.optInt("period")
                val clock = if (g.isNull("clock")) "" else g.optString("clock")
                if (period != null && period >= 1 && ZERO_CLOCK.matches(clock.trim())) {
                    return if (period == 2) "HALFTIME" else "END ${periodLabel(period)}"
                }
                return listOf(periodLabel(period), clock).filter { it.isNotEmpty() }.joinToString(" ")
            }
            "final" -> return "FINAL"
        }
        val ts = g.optString("startTs")
        if (ts.isEmpty()) return ""
        return try {
            val parsed = ISO.parse(ts.replace(Regex("""\.\d+"""), "").replace(Regex("""([+-]\d\d):(\d\d)$"""), "$1$2"))
            if (parsed == null) "" else KICK.format(parsed)
        } catch (_: Exception) {
            ""
        }
    }

    private fun periodLabel(p: Int?): String = when {
        p == null -> ""
        p <= 4 -> "Q$p"
        p == 5 -> "OT"
        else -> "${p - 4}OT"
    }

    // ── Drawing ─────────────────────────────────────────────────────────────
    private fun startCrawl() {
        if (running) return
        running = true
        Choreographer.getInstance().postFrameCallback(frame)
    }

    private fun stopCrawl() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frame)
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        canvas.drawRect(0f, 0f, w, h, pBg)
        canvas.drawRect(0f, 0f, w, 1f, pRule)
        canvas.drawRect(0f, h - 1f, w, h, pRule)
        if (unit == 0f) return

        val baseline = h / 2f - (pTeam.descent() + pTeam.ascent()) / 2f

        // Brand, with a ten-minute nudge so it never sits still for hours.
        val nudge = (((System.currentTimeMillis() / 1000L) % 1200L).let { if (it < 600) it else 1200 - it } / 600f) * unit * 0.15f
        var x = unit * 0.6f + nudge
        canvas.drawText("THE SLATE", x, baseline, pBrand)
        x += pBrand.measureText("THE SLATE") + unit * 0.4f - nudge
        if (week.isNotEmpty()) canvas.drawText(week, x, baseline, pWeek)
        canvas.drawRect(brandWidth - 1f, 0f, brandWidth, h, pRule)

        val left = brandWidth
        val list = chips
        canvas.save()
        canvas.clipRect(left, 0f, w, h)
        if (list.isEmpty()) {
            canvas.drawText(if (loaded) "No games on right now" else "Loading scores", left + unit * 0.9f, baseline, pEmpty)
            canvas.restore()
            return
        }

        val viewport = w - left
        var offset = 0f
        if (running && contentWidth > viewport && startNanos != 0L && frameNanos >= startNanos) {
            val secs = (frameNanos - startNanos) / 1_000_000_000.0
            val pxPerSec = h * 1.5
            offset = ((secs * pxPerSec) % contentWidth).toFloat()
        }

        // Two passes so the end of the list runs straight into its start.
        val passes = if (contentWidth > viewport) 2 else 1
        for (pass in 0 until passes) {
            var cx = left + unit * 0.9f - offset + pass * contentWidth
            for (chip in list) {
                if (cx + chip.width >= left && cx <= w) drawChip(canvas, chip, cx, baseline, h)
                cx += chip.width
                if (cx > w) break
            }
        }
        canvas.restore()
    }

    private fun drawChip(canvas: Canvas, chip: Chip, x0: Float, baseline: Float, h: Float) {
        var x = x0
        for (s in chip.segs) {
            x += s.gapBefore
            if (s.dot) {
                val r = unit * 0.17f
                canvas.drawCircle(x + r, h / 2f, r, pDot)
            } else {
                canvas.drawText(s.text, x, baseline, s.paint)
            }
            x += segWidth(s)
        }
    }

    private companion object {
        // Tokens from src/app/globals.css (dark theme).
        val ACCENT = Color.parseColor("#f2b63c")
        val CHALK = Color.parseColor("#f2eee5")
        val CHALK_45 = Color.argb(115, 0xf2, 0xee, 0xe5)
        val CHALK_40 = Color.argb(102, 0xf2, 0xee, 0xe5)
        val DIM = Color.parseColor("#a89f90")
        val LIVE = Color.parseColor("#ff4b57")
        val WIN = Color.parseColor("#34c77b")
        val LOSS = Color.parseColor("#f0616d")
        val PANEL = Color.argb(225, 0x0b, 0x0a, 0x08)
        val RULE = Color.argb(23, 255, 255, 255)
        val ZERO_CLOCK = Regex("""^0+:00$""")
        val ISO = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US)
        val KICK = SimpleDateFormat("h:mm a", Locale.US).apply { timeZone = TimeZone.getDefault() }
    }
}
