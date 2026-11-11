package com.chasevandiver.tvoverlay

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * The other TVs on this Wi-Fi running TV Overlay (TV-9). A subnet scan takes a
 * few seconds, so the list is cached; "All TVs" on the phone page sends each
 * command here once and this TV relays it, which also keeps the phone free of
 * cross-origin requests between TVs.
 */
object Peers {
    private const val TTL_MS = 5 * 60 * 1000L
    @Volatile private var cache: JSONArray = JSONArray()
    @Volatile private var at = 0L

    @Synchronized
    fun list(refresh: Boolean = false): JSONArray {
        if (refresh || System.currentTimeMillis() - at > TTL_MS) {
            cache = SelfGrant.findPeers()
            at = System.currentTimeMillis()
        }
        return cache
    }

    /** Fire-and-forget the same command to every other TV. */
    fun relay(path: String, body: JSONObject) {
        thread(isDaemon = true) { relayNow(path, body) }
    }

    private fun relayNow(path: String, body: JSONObject) {
        // A cold cache means a few-second scan; never make the phone wait on it.
        val peers = list()
        val payload = JSONObject(body.toString()).put("all", false).toString()
        for (i in 0 until peers.length()) {
            val ip = peers.optJSONObject(i)?.optString("ip") ?: continue
            thread(isDaemon = true) {
                try {
                    val c = URL("http://$ip:${OverlayService.PORT}$path").openConnection() as HttpURLConnection
                    c.connectTimeout = 2_000
                    c.readTimeout = 70_000
                    c.requestMethod = "POST"
                    c.doOutput = true
                    c.setRequestProperty("Content-Type", "application/json")
                    c.outputStream.use { it.write(payload.toByteArray()) }
                    c.inputStream.use { it.readBytes() }
                } catch (_: Exception) {
                    /* that TV is off or asleep; the next command tries again */
                }
            }
        }
    }
}
