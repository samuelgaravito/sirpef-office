package ve.gob.mppef.sirpefoffice.firma.data

import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * Canal de eventos de la API para la app Android.
 *
 * Se usa el mismo `/api/ws` de la web, autenticado con el access token en la
 * cabecera. Solo mientras la app está abierta: con la app cerrada el aviso
 * llega por FCM.
 */
class RealtimeClient(
    private val baseUrl: String,
    private val sessionStore: SessionStore,
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private val handler = Handler(Looper.getMainLooper())

    private var socket: WebSocket? = null
    private var running = false
    private var attempts = 0
    private var listener: ((String) -> Unit)? = null

    private fun url(): String {
        val trimmed = baseUrl.trimEnd('/')
        val scheme = when {
            trimmed.startsWith("https://") -> "wss://"
            trimmed.startsWith("http://") -> "ws://"
            else -> trimmed
        }
        val rest = trimmed
            .removePrefix("https://")
            .removePrefix("http://")
        return "$scheme$rest/ws"
    }

    fun connect(onEvent: (String) -> Unit) {
        listener = onEvent
        if (running && socket != null) return
        running = true
        open()
    }

    fun close() {
        running = false
        handler.removeCallbacksAndMessages(null)
        socket?.close(1000, "Cierre de sesión")
        socket = null
    }

    private fun open() {
        if (!running) return
        val token = sessionStore.current?.accessToken ?: run {
            scheduleReconnect()
            return
        }

        val request = Request.Builder()
            .url(url())
            .header("Authorization", "Bearer $token")
            .build()

        socket?.cancel()
        socket = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    attempts = 0
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    listener?.invoke(text)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (running && socket === webSocket) scheduleReconnect()
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (running && socket === webSocket) scheduleReconnect()
                }
            },
        )
    }

    private fun scheduleReconnect() {
        if (!running) return
        val delay = minOf(30_000L, 1_000L * (1 shl minOf(attempts, 5)))
        attempts += 1
        handler.postDelayed({ open() }, delay)
    }
}
