package com.chasevandiver.tvoverlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Keeps the phone control server up after the TV reboots or the app updates. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            OverlayService.send(context)
        } catch (_: Exception) {
            /* some Fire OS builds refuse background starts until first launch */
        }
    }
}
