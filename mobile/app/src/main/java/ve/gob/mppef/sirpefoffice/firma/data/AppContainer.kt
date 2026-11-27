package ve.gob.mppef.sirpefoffice.firma.data

import android.content.Context
import kotlinx.coroutines.flow.MutableSharedFlow
import ve.gob.mppef.sirpefoffice.firma.BuildConfig

class AppContainer(context: Context) {
    val appContext: Context = context.applicationContext
    val sessionStore = SessionStore(appContext)
    val deviceRevoked = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val svaApi = ApiFactory.sva(BuildConfig.SVA_BASE_URL)
    val sirpefApi = ApiFactory.sirpef(BuildConfig.SIRPEF_BASE_URL, sessionStore) {
        deviceRevoked.tryEmit(Unit)
    }
    val deviceKeyManager = DeviceKeyManager(appContext)
    val pdfCache = PdfCache(appContext)
    val realtimeClient = RealtimeClient(BuildConfig.SIRPEF_BASE_URL, sessionStore)
}
