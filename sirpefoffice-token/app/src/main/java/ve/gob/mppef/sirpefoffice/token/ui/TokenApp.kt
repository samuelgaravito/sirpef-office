package ve.gob.mppef.sirpefoffice.token.ui

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
import ve.gob.mppef.sirpefoffice.token.ui.screens.LinkScreen
import ve.gob.mppef.sirpefoffice.token.ui.screens.TokenPairLoginScreen
import ve.gob.mppef.sirpefoffice.token.ui.screens.ProfileScreen
import ve.gob.mppef.sirpefoffice.token.ui.screens.TokenScreen
import ve.gob.mppef.sirpefoffice.token.ui.theme.Background
import ve.gob.mppef.sirpefoffice.token.ui.theme.Indigo

@Composable
fun TokenApp(viewModel: MainViewModel, activity: FragmentActivity) {
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.error, state.info) {
        val message = state.error ?: state.info
        if (message != null) {
            snackbar.showSnackbar(message)
            viewModel.clearMessages()
        }
    }

    BackHandler(enabled = state.screen == Screen.PROFILE) {
        viewModel.back()
    }

    val context = LocalContext.current
    val darkIcons = state.screen == Screen.PROFILE
    SideEffect {
        val windowActivity = context as? android.app.Activity ?: return@SideEffect
        WindowCompat.getInsetsController(windowActivity.window, windowActivity.window.decorView)
            .isAppearanceLightStatusBars = darkIcons
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
                Screen.LOGIN -> TokenPairLoginScreen(
                    state = state,
                    onPair = { code -> viewModel.pairWithoutSession(code, activity) },
                    onConfirmReplace = { viewModel.confirmReplace(activity) },
                    onCancelReplace = viewModel::cancelReplace,
                )

                Screen.LINK -> LinkScreen(
                    state = state,
                    onPair = { code, mode -> viewModel.pair(code, mode, false, activity) },
                    onConfirmReplace = { viewModel.confirmReplace(activity) },
                    onCancelReplace = viewModel::cancelReplace,
                    onLogout = viewModel::logout,
                )

                Screen.TOKEN -> TokenScreen(
                    state = state,
                    onUnlock = { viewModel.unlock(activity) },
                    onProfile = viewModel::openProfile,
                    onRefresh = viewModel::refreshStatus,
                )

                Screen.PROFILE -> ProfileScreen(
                    state = state,
                    onBack = viewModel::back,
                    onReset = { viewModel.reset(activity) },
                    onUnpair = viewModel::unpair,
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
