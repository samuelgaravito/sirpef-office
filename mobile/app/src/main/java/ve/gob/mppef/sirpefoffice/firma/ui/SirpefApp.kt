package ve.gob.mppef.sirpefoffice.firma.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.fragment.app.FragmentActivity
import ve.gob.mppef.sirpefoffice.firma.ui.screens.CertificateScreen
import ve.gob.mppef.sirpefoffice.firma.ui.screens.DocumentScreen
import ve.gob.mppef.sirpefoffice.firma.ui.screens.HomeScreen
import ve.gob.mppef.sirpefoffice.firma.ui.screens.LoginScreen
import ve.gob.mppef.sirpefoffice.firma.ui.screens.ProfileScreen
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Background
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Indigo

@Composable
fun SirpefApp(viewModel: MainViewModel, activity: FragmentActivity) {
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.error, state.info) {
        val message = state.error ?: state.info
        if (message != null) {
            snackbar.showSnackbar(message)
            viewModel.clearMessages()
        }
    }

    BackHandler(
        enabled = state.screen == Screen.DOCUMENT ||
            state.screen == Screen.CERTIFICATE ||
            state.screen == Screen.PROFILE,
    ) {
        viewModel.back()
    }

    // Las cabeceras de login/inicio son oscuras; las demás pantallas usan
    // barras claras. Los iconos de estado deben contrastar con cada una.
    val context = LocalContext.current
    val darkStatusIcons = state.screen == Screen.DOCUMENT ||
        state.screen == Screen.CERTIFICATE ||
        state.screen == Screen.PROFILE
    SideEffect {
        val activity = context as? android.app.Activity ?: return@SideEffect
        WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            .isAppearanceLightStatusBars = darkStatusIcons
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Background),
    ) {
        if (!state.initialized) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Indigo)
            }
        } else {
            when (state.screen) {
                Screen.LOGIN -> LoginScreen(
                    loading = state.loading,
                    onLogin = viewModel::login,
                    onLocalLogin = viewModel::loginLocal,
                )

                Screen.HOME -> HomeScreen(
                    state = state,
                    onFilter = viewModel::setFilter,
                    onSearch = viewModel::setSearch,
                    onRefresh = viewModel::refreshDocuments,
                    onDocument = viewModel::selectDocument,
                    onProfile = viewModel::openProfile,
                )

                Screen.DOCUMENT -> DocumentScreen(
                    state = state,
                    activity = activity,
                    onBack = viewModel::back,
                    onSignature = viewModel::setSignature,
                    onApprove = viewModel::approveAndSign,
                    onRetry = viewModel::retrySign,
                    onCertificate = viewModel::openCertificate,
                )

                Screen.CERTIFICATE -> CertificateScreen(
                    state = state,
                    onBack = viewModel::back,
                )

                Screen.PROFILE -> ProfileScreen(
                    state = state,
                    onBack = viewModel::back,
                    onLogout = viewModel::logout,
                )
            }
        }

        SnackbarHost(
            hostState = snackbar,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(16.dp),
        )
    }
}
