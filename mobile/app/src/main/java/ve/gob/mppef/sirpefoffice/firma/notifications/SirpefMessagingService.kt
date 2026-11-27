package ve.gob.mppef.sirpefoffice.firma.notifications

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import ve.gob.mppef.sirpefoffice.firma.BuildConfig
import ve.gob.mppef.sirpefoffice.firma.data.ApiFactory
import ve.gob.mppef.sirpefoffice.firma.data.PushSubscriptionRequest
import ve.gob.mppef.sirpefoffice.firma.data.SessionStore

/**
 * FCM: solo se activa cuando existe google-services.json. Sin ese archivo la
 * clase compila pero Firebase no entrega mensajes.
 */
class SirpefMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        registerToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Con la app visible, el WebSocket ya refresca la lista y muestra el
        // aviso dentro de la app: no se duplica la notificación del sistema.
        if (AppForeground.visible) return

        val title = message.notification?.title ?: "SirpefOffice"
        val body = message.notification?.body ?: "Abre SirpefOffice para revisarlo."
        PushNotifications.show(
            context = applicationContext,
            title = title,
            body = body,
            documentId = message.data["documentId"],
            messageId = message.data["messageId"],
        )
    }

    private fun registerToken(token: String) {
        val store = SessionStore(applicationContext)
        if (store.current == null) return
        val api = ApiFactory.sirpef(BuildConfig.SIRPEF_BASE_URL, store)
        scope.launch {
            runCatching {
                api.registerPushSubscription(
                    PushSubscriptionRequest(
                        endpoint = token,
                        deviceId = store.deviceId,
                        appVersion = BuildConfig.VERSION_NAME,
                    ),
                )
            }
        }
    }
}
