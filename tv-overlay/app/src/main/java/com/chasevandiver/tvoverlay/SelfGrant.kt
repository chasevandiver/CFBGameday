package com.chasevandiver.tvoverlay

import android.content.Context
import dadb.AdbKeyPair
import dadb.Dadb
import java.io.File

/**
 * Fire OS 8 has no screen for the "display over other apps" permission, so it
 * normally takes a laptop and an `adb` command. This does the same thing from
 * the TV itself: connect to the TV's own ADB server over the network loopback
 * and run the one command. The first time, Fire OS shows an "Allow debugging?"
 * box; pick Always allow, then OK.
 *
 * Needs Settings > My Fire TV > Developer options > ADB debugging = ON.
 */
object SelfGrant {
    fun run(ctx: Context): String {
        val dir = ctx.filesDir
        val priv = File(dir, "adbkey")
        val pub = File(dir, "adbkey.pub")
        val keyPair = try {
            if (!priv.exists() || !pub.exists()) AdbKeyPair.generate(priv, pub)
            AdbKeyPair.read(priv, pub)
        } catch (e: Exception) {
            return "Couldn't create a debugging key: ${e.message}"
        }

        val hosts = listOfNotNull("127.0.0.1", Net.localIp()).distinct()
        var lastError: Exception? = null
        for (host in hosts) {
            try {
                // 5s to connect; up to 90s for someone to answer the Allow box.
                Dadb.create(host, 5555, keyPair, 5_000, 90_000).use { adb ->
                    val cmd = "appops set ${ctx.packageName} SYSTEM_ALERT_WINDOW allow"
                    val res = adb.shell(cmd)
                    return if (res.exitCode == 0) {
                        "Done. Overlay permission granted."
                    } else {
                        "ADB answered but the command failed: ${res.allOutput.trim()}"
                    }
                }
            } catch (e: Exception) {
                lastError = e
            }
        }
        return "Couldn't reach this TV's ADB (${lastError?.javaClass?.simpleName}: ${lastError?.message}). " +
            "Turn on ADB debugging in Settings > My Fire TV > Developer options, then try again."
    }
}
