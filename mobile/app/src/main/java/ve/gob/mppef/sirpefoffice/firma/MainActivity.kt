package ve.gob.mppef.sirpefoffice.firma

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.fragment.app.FragmentActivity
import ve.gob.mppef.sirpefoffice.firma.data.AppContainer
import ve.gob.mppef.sirpefoffice.firma.notifications.AppForeground
import ve.gob.mppef.sirpefoffice.firma.notifications.PushNotifications
import ve.gob.mppef.sirpefoffice.firma.ui.MainViewModel
import ve.gob.mppef.sirpefoffice.firma.ui.SirpefApp
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SirpefTheme

class MainActivity : FragmentActivity() {
    private val container by lazy { AppContainer(applicationContext) }
    private val viewModel: MainViewModel by viewModels {
        MainViewModel.Factory(container)
    }

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* El estado se consulta al mostrar el aviso. */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Evita capturas de pantalla y grabaciones del visor, la firma y el certificado.
        // Debug siempre las permite (para revisar la interfaz) y release solo cuando
        // se compila con -PallowScreenshots=true de forma temporal para pruebas.
        if (!BuildConfig.DEBUG && !BuildConfig.ALLOW_SCREENSHOTS) {
            window.setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE,
            )
        }
        enableEdgeToEdge()
        PushNotifications.ensureChannel(this)
        requestNotificationsPermission()
        handleNotificationIntent(intent)
        // La barra de navegación comparte el fondo claro de la app: iconos oscuros.
        WindowCompat.getInsetsController(window, window.decorView)
            .isAppearanceLightNavigationBars = true
        setContent {
            SirpefTheme {
                SirpefApp(viewModel = viewModel, activity = this)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        AppForeground.visible = true
        viewModel.onAppResume()
        handleNotificationIntent(intent)
    }

    override fun onPause() {
        AppForeground.visible = false
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNotificationIntent(intent)
    }

    private fun handleNotificationIntent(intent: Intent?) {
        val documentId = intent?.getStringExtra("documentId")
        val messageId = intent?.getStringExtra("messageId")
        if (documentId != null || messageId != null) {
            viewModel.openFromNotification(documentId, messageId)
            intent.removeExtra("documentId")
            intent.removeExtra("messageId")
        }
    }

    private fun requestNotificationsPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
