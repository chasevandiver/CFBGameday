package com.chasevandiver.tvoverlay

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * In-app updates (TV-9): no more Downloader trips. Each CI build of the app is
 * published to the `tv-overlay` release as "TV Overlay (build N)", and N is
 * the app's versionCode, so a higher N is newer. Installing streams the APK
 * into a PackageInstaller session; Fire OS then shows its own Install screen
 * for a press of the remote. The first time, it asks to allow TV Overlay to
 * install apps (Install unknown apps), same as it did for Downloader.
 */
object Updater {
    private const val RELEASE_API =
        "https://api.github.com/repos/chasevandiver/CFBGameday/releases/tags/tv-overlay"

    @Volatile var latestBuild: Int? = null
        private set
    @Volatile private var apkUrl: String? = null
    @Volatile var status: String? = null

    fun currentBuild(ctx: Context): Int {
        val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode
    }

    /** Updates [latestBuild] when the release is newer than this install. */
    fun check(ctx: Context) {
        try {
            val c = URL(RELEASE_API).openConnection() as HttpURLConnection
            c.connectTimeout = 8_000
            c.readTimeout = 8_000
            c.setRequestProperty("Accept", "application/vnd.github+json")
            c.setRequestProperty("User-Agent", "tv-overlay")
            val json = JSONObject(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) })
            val build = Regex("""build (\d+)""").find(json.optString("name"))?.groupValues?.get(1)?.toInt()
                ?: return
            val asset = json.optJSONArray("assets")?.optJSONObject(0) ?: return
            apkUrl = asset.optString("browser_download_url")
            latestBuild = if (build > currentBuild(ctx)) build else null
        } catch (_: Exception) {
            /* offline or rate-limited; try again later */
        }
    }

    fun install(ctx: Context) {
        val url = apkUrl ?: run { status = "No update found yet. Try again in a minute."; return }
        status = "Downloading the update…"
        thread(isDaemon = true) {
            try {
                val app = ctx.applicationContext
                val installer = app.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                params.setAppPackageName(app.packageName)
                val id = installer.createSession(params)
                installer.openSession(id).use { session ->
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = 10_000
                    conn.readTimeout = 60_000
                    conn.instanceFollowRedirects = true
                    conn.inputStream.use { input ->
                        session.openWrite("tv-overlay.apk", 0, -1).use { out ->
                            input.copyTo(out)
                            session.fsync(out)
                        }
                    }
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                        (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                    val pending = PendingIntent.getBroadcast(app, id, Intent(app, InstallReceiver::class.java), flags)
                    status = "Check the TV: pick Install to finish updating."
                    session.commit(pending.intentSender)
                }
            } catch (e: Exception) {
                status = "Update failed: ${e.message}"
            }
        }
    }
}

/** Fire OS reports back here: show its confirm screen, or record the outcome. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    context.startActivity(confirm)
                } catch (e: Exception) {
                    Updater.status = "Open TV Overlay on the TV and pick Install update there."
                }
            }
            PackageInstaller.STATUS_SUCCESS -> Updater.status = "Updated."
            else -> Updater.status =
                "Update didn't finish: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "cancelled"}"
        }
    }
}
