package com.chasevandiver.tvoverlay

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * A tiny HTTP server so a phone on the same Wi-Fi can drive the overlay.
 * The remote stays with the show; the phone is the overlay's remote.
 *
 *   GET  /             the control page
 *   GET  /api/state    current config, presets, permission status
 *   POST /api/show     {url?, layout?, position?, size?, opacity?, zoom?}
 *   POST /api/hide
 *   POST /api/reload
 *   POST /api/presets  [ {name, url, layout, position, size, zoom}, ... ]
 *   GET  /api/peers       other TVs on this Wi-Fi running the app
 *   POST /api/grant-peer  {ip}  grant the overlay permission on that TV
 */
class ControlServer(private val svc: OverlayService, private val port: Int) {
    @Volatile private var running = false
    @Volatile private var socket: ServerSocket? = null

    fun start() {
        running = true
        thread(name = "control-server", isDaemon = true) {
            while (running) {
                try {
                    ServerSocket().use { ss ->
                        ss.reuseAddress = true
                        ss.bind(InetSocketAddress(port))
                        socket = ss
                        while (running) {
                            val client = ss.accept()
                            thread(isDaemon = true) { handle(client) }
                        }
                    }
                } catch (e: Exception) {
                    if (running) Thread.sleep(3_000)
                }
            }
        }
    }

    fun stop() {
        running = false
        try { socket?.close() } catch (_: Exception) { }
    }

    private fun handle(client: Socket) {
        try {
            client.use { c ->
                c.soTimeout = 10_000
                val input = BufferedInputStream(c.getInputStream())
                val requestLine = readLine(input) ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 2) return
                val method = parts[0].uppercase()
                val path = parts[1].substringBefore("?")

                var length = 0
                while (true) {
                    val line = readLine(input) ?: break
                    if (line.isEmpty()) break
                    val idx = line.indexOf(':')
                    if (idx > 0 && line.substring(0, idx).trim().equals("content-length", ignoreCase = true)) {
                        length = line.substring(idx + 1).trim().toIntOrNull()?.coerceIn(0, 256_000) ?: 0
                    }
                }
                val body = if (length > 0) {
                    val buf = ByteArray(length)
                    var read = 0
                    while (read < length) {
                        val n = input.read(buf, read, length - read)
                        if (n < 0) break
                        read += n
                    }
                    String(buf, 0, read, Charsets.UTF_8)
                } else ""

                val (status, type, out) = try {
                    route(method, path, body)
                } catch (e: Exception) {
                    Triple("400 Bad Request", JSON, JSONObject().put("error", e.message ?: "bad request").toString().toByteArray())
                }
                val head = "HTTP/1.1 $status\r\n" +
                    "Content-Type: $type\r\n" +
                    "Content-Length: ${out.size}\r\n" +
                    "Cache-Control: no-store\r\n" +
                    "Access-Control-Allow-Origin: *\r\n" +
                    "Access-Control-Allow-Headers: content-type\r\n" +
                    "Connection: close\r\n\r\n"
                val os = c.getOutputStream()
                os.write(head.toByteArray())
                os.write(out)
                os.flush()
            }
        } catch (_: Exception) {
            /* client went away mid-request */
        }
    }

    private fun route(method: String, path: String, body: String): Triple<String, String, ByteArray> {
        if (method == "OPTIONS") return Triple("204 No Content", "text/plain", ByteArray(0))
        return when {
            method == "GET" && (path == "/" || path == "/index.html") ->
                Triple("200 OK", "text/html; charset=utf-8", svc.assets.open("control.html").use { it.readBytes() })
            method == "GET" && path == "/api/state" -> ok()
            // "all": true runs it here and relays it to every other TV (TV-9).
            method == "POST" && path == "/api/show" -> {
                val j = if (body.isBlank()) JSONObject() else JSONObject(body)
                val all = j.optBoolean("all")
                j.remove("all")
                svc.show(j)
                if (all) Peers.relay(path, j)
                ok()
            }
            method == "POST" && path == "/api/hide" -> {
                svc.hide()
                if (body.isNotBlank() && JSONObject(body).optBoolean("all")) Peers.relay(path, JSONObject())
                ok()
            }
            method == "POST" && path == "/api/name" -> {
                svc.store.name = JSONObject(body).optString("name")
                ok()
            }
            method == "POST" && path == "/api/update" -> {
                Updater.install(svc)
                if (body.isNotBlank() && JSONObject(body).optBoolean("all")) Peers.relay(path, JSONObject())
                ok()
            }
            method == "POST" && path == "/api/reload" -> { svc.reloadPage(); ok() }
            method == "POST" && path == "/api/presets" -> { svc.savePresets(JSONArray(body)); ok() }
            // Setting up other TVs: Amazon blocks a TV's apps from ADB-ing the
            // TV itself, so each TV grants the others.
            method == "GET" && path == "/api/peers" ->
                Triple("200 OK", JSON, Peers.list(refresh = true).toString().toByteArray())
            method == "GET" && path == "/api/peers-cached" ->
                Triple("200 OK", JSON, Peers.list().toString().toByteArray())
            method == "POST" && path == "/api/grant-peer" -> {
                val ip = JSONObject(body).optString("ip").trim()
                Triple("200 OK", JSON, SelfGrant.grantPeer(svc, ip).toString().toByteArray())
            }
            else -> Triple("404 Not Found", "text/plain", "not found".toByteArray())
        }
    }

    private fun ok() = Triple("200 OK", JSON, svc.state().toString().toByteArray())

    private fun readLine(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) return if (buf.size() == 0) null else buf.toString("UTF-8")
            if (b == '\n'.code) break
            if (b != '\r'.code) buf.write(b)
            if (buf.size() > 8192) break
        }
        return buf.toString("UTF-8")
    }

    private companion object {
        const val JSON = "application/json; charset=utf-8"
    }
}
