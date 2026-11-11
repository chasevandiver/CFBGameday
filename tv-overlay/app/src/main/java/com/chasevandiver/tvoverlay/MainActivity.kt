package com.chasevandiver.tvoverlay

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * The on-TV screen: shows the phone address, grants the overlay permission,
 * and has a couple of buttons for testing with the remote.
 */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var address: TextView
    private lateinit var message: TextView
    private lateinit var grant: Button
    private lateinit var settingsBtn: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        OverlayService.send(this)

        val pad = dp(48)
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, dp(36), pad, dp(36))
            setBackgroundColor(Color.rgb(16, 14, 11))
        }

        col.addView(text("TV Overlay", 34f, GOLD, bold = true))
        status = text("", 18f, CHALK).also { col.addView(it, spaced(12)) }
        // Progress and errors from Grant permission, right under the status
        // so nothing below the fold goes unseen.
        message = text("", 18f, GOLD).also { col.addView(it, spaced(8)) }
        address = text("", 26f, CHALK, bold = true).also { col.addView(it, spaced(20)) }
        col.addView(
            text("Open that address on your phone (same Wi-Fi) to pick what shows, move it, or hide it.", 16f, DIM),
            spaced(6),
        )

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        grant = button("Grant permission") { runGrant() }
        row.addView(grant)
        settingsBtn = button("Open TV settings") { openOverlaySettings() }
        row.addView(settingsBtn)
        row.addView(button("Show CFB ticker") {
            OverlayService.instance?.show(JSONObject(store().presets.optJSONObject(0)?.toString() ?: "{}"))
            refresh()
        })
        row.addView(button("Show scoreboard") {
            OverlayService.instance?.show(JSONObject(store().presets.optJSONObject(1)?.toString() ?: "{}"))
            refresh()
        })
        row.addView(button("Hide overlay") {
            OverlayService.instance?.hide()
            refresh()
        })
        col.addView(row, spaced(28))

        col.addView(
            text(
                "First time on this TV: Settings > Developer options > ADB debugging ON (on some " +
                    "TVs it's under My Fire TV or Device & Software), then come back here and pick " +
                    "Grant permission. If a box asks to allow debugging, check Always allow and pick OK. " +
                    "If Grant permission keeps failing, try Open TV settings: some TVs have a " +
                    "\"Display over other apps\" switch there.",
                15f, DIM,
            ),
            spaced(28),
        )

        setContentView(ScrollView(this).apply { addView(col) })
        grant.requestFocus()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun store() = OverlayService.instance?.store ?: Store(this)

    private fun refresh() {
        val can = OverlayService.canDraw(this)
        status.text = if (can) "Overlay permission: granted" else "Overlay permission: not granted yet"
        status.setTextColor(if (can) GREEN else RED)
        grant.visibility = if (can) View.GONE else View.VISIBLE
        settingsBtn.visibility = if (can) View.GONE else View.VISIBLE
        if (can && message.text.isNullOrEmpty()) message.text = "Ready. Use your phone to pick what shows."
        val ip = Net.localIp()
        address.text = if (ip != null) "http://$ip:${OverlayService.PORT}" else "Not on a network"
        if (message.text.isNullOrEmpty()) OverlayService.instance?.lastError?.let { message.text = it }
    }

    private fun runGrant() {
        grant.isEnabled = false
        message.text = "Starting…"
        thread {
            val result = SelfGrant.run(this) { step -> runOnUiThread { message.text = step } }
            runOnUiThread {
                grant.isEnabled = true
                refresh()
                message.text = result
            }
        }
    }

    /** Fallback for Fire OS builds that still have the system switch. */
    private fun openOverlaySettings() {
        val intents = listOf(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")),
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")),
        )
        for (i in intents) {
            try {
                startActivity(i)
                return
            } catch (_: Exception) {
            }
        }
        message.text = "This TV has no settings screen for that permission. Use Grant permission instead."
    }

    private fun text(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        textSize = 16f
        isAllCaps = false
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { marginEnd = dp(16) }
        gravity = Gravity.CENTER
    }

    private fun spaced(topDp: Int) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(topDp) }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private companion object {
        val GOLD = Color.rgb(232, 184, 75)
        val CHALK = Color.rgb(242, 238, 230)
        val DIM = Color.rgb(160, 152, 140)
        val GREEN = Color.rgb(90, 200, 120)
        val RED = Color.rgb(255, 95, 105)
    }
}
