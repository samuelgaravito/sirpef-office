package ve.gob.mppef.sirpefoffice.token

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
import androidx.fragment.app.FragmentActivity
import ve.gob.mppef.sirpefoffice.token.data.AppContainer
import ve.gob.mppef.sirpefoffice.token.ui.MainViewModel
import ve.gob.mppef.sirpefoffice.token.ui.TokenApp
import ve.gob.mppef.sirpefoffice.token.ui.theme.SirpefTheme

class MainActivity : FragmentActivity() {
    private val container by lazy { AppContainer(applicationContext) }
    private val viewModel: MainViewModel by viewModels {
        MainViewModel.Factory(container)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.DEBUG && !BuildConfig.ALLOW_SCREENSHOTS) {
            window.setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE,
            )
        }
        enableEdgeToEdge()
        WindowCompat.getInsetsController(window, window.decorView)
            .isAppearanceLightNavigationBars = true
        setContent {
            SirpefTheme {
                TokenApp(viewModel = viewModel, activity = this)
            }
        }
    }

    override fun onStop() {
        // El secreto solo vive en memoria mientras la app está visible.
        viewModel.lock()
        super.onStop()
    }
}
