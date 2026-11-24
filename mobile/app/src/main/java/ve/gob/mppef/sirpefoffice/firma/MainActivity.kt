package ve.gob.mppef.sirpefoffice.firma

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
import androidx.fragment.app.FragmentActivity
import ve.gob.mppef.sirpefoffice.firma.data.AppContainer
import ve.gob.mppef.sirpefoffice.firma.ui.MainViewModel
import ve.gob.mppef.sirpefoffice.firma.ui.SirpefApp
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SirpefTheme

class MainActivity : FragmentActivity() {
    private val container by lazy { AppContainer(applicationContext) }
    private val viewModel: MainViewModel by viewModels {
        MainViewModel.Factory(container)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Evita capturas de pantalla y grabaciones del visor, la firma y el certificado.
        // En depuración se omite para poder revisar la interfaz y adjuntar capturas al soporte.
        if (!BuildConfig.DEBUG) {
            window.setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE,
            )
        }
        enableEdgeToEdge()
        // La barra de navegación comparte el fondo claro de la app: iconos oscuros.
        WindowCompat.getInsetsController(window, window.decorView)
            .isAppearanceLightNavigationBars = true
        setContent {
            SirpefTheme {
                SirpefApp(viewModel = viewModel, activity = this)
            }
        }
    }
}
