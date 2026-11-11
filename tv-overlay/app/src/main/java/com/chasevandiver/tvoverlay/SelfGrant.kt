package com.chasevandiver.tvoverlay

import android.content.Context
import dadb.AdbKeyPair
import dadb.Dadb
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Fire OS 8 has no screen for the "display over other apps" permission, so it
 * normally takes a laptop and an `adb` command. This does the same thing from
 * the TV itself: connect to the TV's own ADB server over the network loopback
 * and run the one command. The first time, Fire OS shows an "Allow debugging?"
 * box; pick Always allow, then OK.
 *
 * Needs Developer options > ADB debugging = ON.
 *
 * Every step reports through [progress] so the TV screen never looks frozen,
 * and every failure, including a library that won't load on this Fire OS,
 * comes back as text instead of a silent dead thread.
 */
object SelfGrant {
    private const val PORT = 5555

    fun run(ctx: Context, progress: (String) -> Unit): String = try {
        attempt(ctx, progress)
    } catch (t: Throwable) {
        "Something broke while granting (${t.javaClass.simpleName}: ${t.message}). Send a photo of this screen."
    }

    private fun attempt(ctx: Context, progress: (String) -> Unit): String {
        // 1. Is anything listening? A closed port means ADB debugging is off,
        //    and that answer should take one second, not a two-minute timeout.
        val hosts = listOfNotNull("127.0.0.1", Net.localIp()).distinct()
        progress("Step 1 of 3: looking for this TV's ADB on port $PORT…")
        val host = hosts.firstOrNull { portOpen(it) }
            ?: return "Step 1 failed: nothing is answering on port $PORT, so ADB debugging is off. " +
                "Open Developer options, turn ADB debugging on (or off and back on), then try again."

        // 2. Key for this app, made once and reused so "Always allow" sticks.
        progress("Step 2 of 3: preparing a debugging key…")
        val dir = ctx.filesDir
        val priv = File(dir, "adbkey")
        val pub = File(dir, "adbkey.pub")
        if (!priv.exists() || !pub.exists()) AdbKeyPair.generate(priv, pub)
        val keyPair = AdbKeyPair.read(priv, pub)

        // 3. Connect and run the command. The Allow box appears here.
        progress(
            "Step 3 of 3: asking the TV for permission ($host). A box should pop up now: " +
                "check Always allow, then pick OK. Waiting up to 60 seconds…",
        )
        Dadb.create(host, PORT, keyPair, 4_000, 60_000).use { adb ->
            val res = adb.shell("appops set ${ctx.packageName} SYSTEM_ALERT_WINDOW allow")
            return if (res.exitCode == 0) {
                "Done. Overlay permission granted."
            } else {
                "The TV ran the command but said no (exit ${res.exitCode}): ${res.allOutput.trim()}"
            }
        }
    }

    private fun portOpen(host: String): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(host, PORT), 1_500); true }
    } catch (e: Exception) {
        false
    }
}
