package com.chasevandiver.tvoverlay

import android.content.Context
import dadb.AdbKeyPair
import dadb.Dadb
import org.json.JSONArray
import org.json.JSONObject
import java.io.EOFException
import java.io.File
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Grants the overlay permission ("display over other apps") over ADB.
 *
 * Fire OS 8 has no settings screen for it, and since Fire OS 7.6.6.9 / 8.1.0.3
 * Amazon refuses ADB connections an app makes to its own TV (the TV just hangs
 * up, which surfaces as EOFException). Connections from another device are
 * still allowed, so one TV running this app grants the permission to another:
 * [grantPeer]. [grantSelf] stays for older firmware, where it still works.
 *
 * The first connection from a given TV makes the TARGET TV show "Allow
 * debugging?"; pick Always allow, then OK, on that TV.
 */
object SelfGrant {
    private const val ADB_PORT = 5555
    const val PACKAGE = "com.chasevandiver.tvoverlay"

    /** Older Fire OS only. Every step reports through [progress]. */
    fun grantSelf(ctx: Context, progress: (String) -> Unit): String = try {
        progress("Step 1 of 2: looking for this TV's ADB on port $ADB_PORT…")
        val host = listOfNotNull("127.0.0.1", Net.localIp()).distinct().firstOrNull { portOpen(it, ADB_PORT) }
            ?: return "Nothing is answering on port $ADB_PORT, so ADB debugging is off. " +
                "Open Developer options and turn ADB debugging on."
        progress("Step 2 of 2: asking the TV. If a box pops up, check Always allow and pick OK…")
        runGrant(ctx, host)
    } catch (e: EOFException) {
        BLOCKED
    } catch (t: Throwable) {
        if (t.cause is EOFException) BLOCKED else "Something broke (${t.javaClass.simpleName}: ${t.message})."
    }

    /** Grant the app on the TV at [ip]. Blocks until that TV's Allow box is answered (60s max). */
    fun grantPeer(ctx: Context, ip: String): JSONObject {
        val result = JSONObject().put("ip", ip)
        if (!IPV4.matches(ip)) return result.put("ok", false).put("message", "That isn't an IP address.")
        if (ip == Net.localIp()) {
            return result.put("ok", false)
                .put("message", "That's this TV. Amazon won't let a TV grant itself; use another TV's page.")
        }
        if (!portOpen(ip, ADB_PORT)) {
            return result.put("ok", false)
                .put("message", "That TV isn't answering on port $ADB_PORT. Turn on ADB debugging in its Developer options.")
        }
        return try {
            val msg = runGrant(ctx, ip)
            result.put("ok", msg.startsWith("Done")).put("message", msg)
        } catch (t: Throwable) {
            val why = if (t is EOFException || t.cause is EOFException) {
                "That TV hung up. If its Allow box appeared and was dismissed, try again and pick Always allow, then OK."
            } else {
                "Couldn't finish (${t.javaClass.simpleName}: ${t.message ?: "timed out waiting for Allow"})."
            }
            result.put("ok", false).put("message", why)
        }
    }

    /** Every other TV on this Wi-Fi running TV Overlay, with whether it's granted. */
    fun findPeers(): JSONArray {
        val me = Net.localIp() ?: return JSONArray()
        val prefix = me.substringBeforeLast('.')
        val pool = Executors.newFixedThreadPool(48)
        try {
            val jobs = (1..254).map { "$prefix.$it" }.filter { it != me }.map { ip ->
                pool.submit<JSONObject?> { probe(ip) }
            }
            val out = JSONArray()
            for (j in jobs) {
                try { j.get(5, TimeUnit.SECONDS)?.let { out.put(it) } } catch (_: Exception) { }
            }
            return out
        } finally {
            pool.shutdownNow()
        }
    }

    private fun probe(ip: String): JSONObject? {
        if (!portOpen(ip, OverlayService.PORT, 400)) return null
        return try {
            val conn = URL("http://$ip:${OverlayService.PORT}/api/state").openConnection() as HttpURLConnection
            conn.connectTimeout = 1_500
            conn.readTimeout = 2_000
            val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            val s = JSONObject(body)
            JSONObject().put("ip", ip).put("device", s.optString("device"))
                .put("canDraw", s.optBoolean("canDraw"))
        } catch (e: Exception) {
            null
        }
    }

    private fun runGrant(ctx: Context, host: String): String {
        val dir = ctx.filesDir
        val priv = File(dir, "adbkey")
        val pub = File(dir, "adbkey.pub")
        if (!priv.exists() || !pub.exists()) AdbKeyPair.generate(priv, pub)
        val keyPair = AdbKeyPair.read(priv, pub)
        Dadb.create(host, ADB_PORT, keyPair, 4_000, 60_000).use { adb ->
            var res = adb.shell("appops set $PACKAGE SYSTEM_ALERT_WINDOW allow")
            if (res.exitCode != 0) res = adb.shell("pm grant $PACKAGE android.permission.SYSTEM_ALERT_WINDOW")
            return if (res.exitCode == 0) {
                "Done. Overlay permission granted."
            } else {
                "The TV ran the command but said no: ${res.allOutput.trim()}"
            }
        }
    }

    private fun portOpen(host: String, port: Int, timeoutMs: Int = 1_500): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(host, port), timeoutMs); true }
    } catch (e: Exception) {
        false
    }

    private val IPV4 = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""")

    const val BLOCKED =
        "Amazon blocks apps from granting this on their own TV. Have another TV do it: on your phone, " +
            "open the page for a different TV with TV Overlay and use Set up other TVs."
}
