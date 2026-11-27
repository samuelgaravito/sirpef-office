package ve.gob.mppef.sirpefoffice.token.data

import android.content.Context
import ve.gob.mppef.sirpefoffice.token.BuildConfig

class AppContainer(context: Context) {
    val appContext: Context = context.applicationContext
    val sessionStore = SessionStore(appContext)
    val secretStore = SecretStore(appContext)
    val svaApi = ApiFactory.sva(BuildConfig.SVA_BASE_URL)
    val sirpefApi = ApiFactory.sirpef(BuildConfig.SIRPEF_BASE_URL, sessionStore)
}
