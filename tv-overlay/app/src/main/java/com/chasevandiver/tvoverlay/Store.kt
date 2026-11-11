package com.chasevandiver.tvoverlay

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** What is on screen right now. Immutable; the store swaps whole copies. */
data class OverlayConfig(
    val url: String,
    /** "ticker" = full-width strip, "corner" = picture-in-picture box. */
    val layout: String,
    /** Ticker: "bottom" | "top". Corner: "tr" | "tl" | "br" | "bl". */
    val position: String,
    /** "s" | "m" | "l" */
    val size: String,
    /** 30..100, how see-through the whole overlay is. */
    val opacity: Int,
    /** 50..150. Below 100 the page gets a wider viewport and is drawn smaller,
     *  which is how a phone-sized site fits a small corner box. */
    val zoom: Int,
    val visible: Boolean,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("url", url).put("layout", layout).put("position", position)
        .put("size", size).put("opacity", opacity).put("zoom", zoom).put("visible", visible)

    /** Applies whichever fields the JSON carries, clamped to legal values. */
    fun merge(j: JSONObject): OverlayConfig {
        val layout = j.optString("layout", layout).let { if (it == "corner") "corner" else "ticker" }
        val pos = j.optString("position", position)
        val position = when (layout) {
            "ticker" -> if (pos == "top") "top" else "bottom"
            else -> if (pos in setOf("tr", "tl", "br", "bl")) pos else "tr"
        }
        return copy(
            url = j.optString("url", url).trim().ifEmpty { url },
            layout = layout,
            position = position,
            size = j.optString("size", size).let { if (it in setOf("s", "m", "l")) it else "m" },
            opacity = j.optInt("opacity", opacity).coerceIn(30, 100),
            zoom = j.optInt("zoom", zoom).coerceIn(50, 150),
            visible = j.optBoolean("visible", visible),
        )
    }

    companion object {
        val DEFAULT = OverlayConfig(
            url = "https://cfb-gameday.vercel.app/tv/ticker",
            layout = "ticker", position = "bottom", size = "m",
            opacity = 100, zoom = 100, visible = false,
        )
    }
}

class Store(context: Context) {
    private val prefs = context.getSharedPreferences("overlay", Context.MODE_PRIVATE)

    @Volatile
    var config: OverlayConfig = loadConfig()
        private set

    @Volatile
    var presets: JSONArray = loadPresets()
        private set

    @Synchronized
    fun update(transform: (OverlayConfig) -> OverlayConfig): OverlayConfig {
        config = transform(config)
        prefs.edit().putString("config", config.toJson().toString()).apply()
        return config
    }

    /** What this TV is called on the phone page, e.g. "Living room". */
    var name: String
        get() = prefs.getString("name", "") ?: ""
        set(v) = prefs.edit().putString("name", v.trim().take(40)).apply()

    @Synchronized
    fun savePresets(list: JSONArray) {
        val clean = JSONArray()
        for (i in 0 until list.length()) {
            val p = list.optJSONObject(i) ?: continue
            if (p.optString("url").isBlank() || p.optString("name").isBlank()) continue
            clean.put(p)
        }
        presets = clean
        prefs.edit().putString("presets", clean.toString()).apply()
    }

    private fun loadConfig(): OverlayConfig = try {
        prefs.getString("config", null)?.let { OverlayConfig.DEFAULT.merge(JSONObject(it)) }
            ?: OverlayConfig.DEFAULT
    } catch (e: Exception) {
        OverlayConfig.DEFAULT
    }

    private fun loadPresets(): JSONArray = try {
        prefs.getString("presets", null)?.let { JSONArray(it) } ?: defaultPresets()
    } catch (e: Exception) {
        defaultPresets()
    }

    private fun defaultPresets(): JSONArray = JSONArray()
        .put(preset("CFB ticker", "https://cfb-gameday.vercel.app/tv/ticker", "ticker", "bottom", "m", 100))
        .put(preset("CFB scoreboard", "https://cfb-gameday.vercel.app/tv/corner", "corner", "tr", "m", 100))

    private fun preset(name: String, url: String, layout: String, position: String, size: String, zoom: Int) =
        JSONObject().put("name", name).put("url", url).put("layout", layout)
            .put("position", position).put("size", size).put("zoom", zoom)
}
