package com.chasevandiver.tvoverlay

import java.net.Inet4Address
import java.net.NetworkInterface

object Net {
    /** The TV's LAN address (Wi-Fi or Ethernet), for the phone to open. */
    fun localIp(): String? = try {
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
            ?.hostAddress
    } catch (e: Exception) {
        null
    }
}
