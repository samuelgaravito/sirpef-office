package ve.gob.mppef.sirpefoffice.firma.ui.screens

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import kotlinx.coroutines.delay
import ve.gob.mppef.sirpefoffice.firma.ui.UiState
import ve.gob.mppef.sirpefoffice.firma.ui.components.BrandMark
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Background
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandMint
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Danger
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.firma.ui.theme.InkSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Success
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Warning
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White

private enum class PostPairingPhase { SUCCESS, TOKEN, RECOVERY }

/**
 * Cierre del alta: efecto de éxito, asociación de Token y códigos de
 * recuperación. La sesión ya está guardada, así que las llamadas al backend
 * funcionan mientras se recorre este onboarding.
 */
@Composable
fun PostPairingScreen(
    state: UiState,
    onStartTokenPairing: () -> Unit,
    onGenerateRecoveryCodes: () -> Unit,
    onRefreshTokenStatus: () -> Unit,
    onFinish: () -> Unit,
) {
    var phase by rememberSaveable { mutableStateOf(PostPairingPhase.SUCCESS) }
    var recoveryConfirmed by rememberSaveable { mutableStateOf(false) }
    val view = LocalView.current

    // El éxito y el paso de Token tienen cabecera oscura; la recuperación es
    // clara y necesita iconos de estado oscuros.
    SideEffect {
        val window = (view.context as? Activity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view)
            .isAppearanceLightStatusBars = phase == PostPairingPhase.RECOVERY
    }

    LaunchedEffect(Unit) {
        onRefreshTokenStatus()
        delay(1500)
        phase = PostPairingPhase.TOKEN
    }

    LaunchedEffect(phase) {
        if (phase != PostPairingPhase.TOKEN) return@LaunchedEffect
        while (true) {
            onRefreshTokenStatus()
            delay(2000)
        }
    }

    LaunchedEffect(state.tokenStatus?.paired, phase) {
        if (phase == PostPairingPhase.TOKEN && state.tokenStatus?.paired == true) {
            delay(700)
            phase = PostPairingPhase.RECOVERY
        }
    }

    AnimatedContent(
        targetState = phase,
        transitionSpec = {
            (fadeIn(tween(280)) + scaleIn(initialScale = 0.96f)) togetherWith
                fadeOut(tween(180))
        },
        label = "post-vinculacion",
    ) { current ->
        when (current) {
            PostPairingPhase.SUCCESS -> PairingSuccessScreen()
            PostPairingPhase.TOKEN -> TokenOnboardingScreen(
                state = state,
                onStartTokenPairing = onStartTokenPairing,
                onContinue = { phase = PostPairingPhase.RECOVERY },
            )
            PostPairingPhase.RECOVERY -> RecoveryOnboardingScreen(
                state = state,
                confirmed = recoveryConfirmed,
                onConfirmed = { recoveryConfirmed = it },
                onGenerate = onGenerateRecoveryCodes,
                onFinish = onFinish,
            )
        }
    }
}

@Composable
private fun PairingSuccessScreen() {
    val ring = remember { Animatable(0f) }
    val checkScale = remember { Animatable(0.2f) }
    val textAlpha = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        checkScale.animateTo(
            1f,
            spring(
                dampingRatio = Spring.DampingRatioMediumBouncy,
                stiffness = Spring.StiffnessLow,
            ),
        )
        ring.animateTo(1f, tween(900, easing = LinearOutSlowInEasing))
        textAlpha.animateTo(1f, tween(450, easing = FastOutSlowInEasing))
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF02152E), Ink, InkSoft),
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            Box(
                modifier = Modifier.size(180.dp),
                contentAlignment = Alignment.Center,
            ) {
                Canvas(Modifier.fillMaxSize()) {
                    val base = size.minDimension / 2f
                    val progress = ring.value
                    for (index in 0..2) {
                        val delayed = (progress - index * 0.12f).coerceIn(0f, 1f)
                        if (delayed <= 0f) continue
                        drawCircle(
                            color = BrandMint.copy(alpha = (1f - delayed) * 0.28f),
                            radius = base * (0.45f + delayed * 0.5f),
                            style = Stroke(width = 2.dp.toPx()),
                        )
                    }
                    val particleProgress = ring.value
                    if (particleProgress > 0f) {
                        repeat(12) { index ->
                            val angle = (Math.PI * 2.0 * index / 12.0)
                            val distance = base * (0.35f + particleProgress * 0.85f)
                            val x = center.x + (Math.cos(angle) * distance).toFloat()
                            val y = center.y + (Math.sin(angle) * distance).toFloat()
                            drawCircle(
                                color = BrandMint.copy(alpha = (1f - particleProgress) * 0.9f),
                                radius = (3 + (index % 3)).dp.toPx(),
                                center = Offset(x, y),
                            )
                        }
                    }
                }

                Box(
                    modifier = Modifier
                        .size(104.dp)
                        .background(BrandMint, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.Check,
                        contentDescription = null,
                        tint = Ink,
                        modifier = Modifier
                            .size(58.dp)
                            .graphicsLayer {
                                scaleX = checkScale.value
                                scaleY = checkScale.value
                            },
                    )
                }
            }

            Spacer(Modifier.height(28.dp))
            Text(
                "Teléfono vinculado",
                color = White,
                style = MaterialTheme.typography.displaySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp),
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Este teléfono ya es el único autorizado para firmar.",
                color = Color(0xFFB7CFE6),
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        }
    }

}

@Composable
private fun TokenOnboardingScreen(
    state: UiState,
    onStartTokenPairing: () -> Unit,
    onContinue: () -> Unit,
) {
    val context = LocalContext.current
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val paired = state.tokenStatus?.paired == true

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Background),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .windowInsetsPadding(WindowInsets.statusBars),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Brush.linearGradient(listOf(Color(0xFF02152E), Ink, InkSoft)))
                    .padding(horizontal = 24.dp, vertical = 30.dp),
            ) {
                Column {
                    BrandMark(size = 46.dp)
                    Spacer(Modifier.height(14.dp))
                    Text(
                        "Asocia SirpefOffice Token",
                        color = White,
                        style = MaterialTheme.typography.headlineSmall,
                    )
                    Text(
                        "El Token genera el código de 6 dígitos que usarás al entrar y al firmar.",
                        color = Color(0xFFB7CFE6),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                shape = RoundedCornerShape(26.dp),
                colors = CardDefaults.cardColors(containerColor = White),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(Modifier.padding(22.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(42.dp)
                                .background(Color(0xFFE9F1FA), CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Outlined.Key, contentDescription = null, tint = Indigo)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(
                                if (paired) "Token activo" else "Vincula la app Token",
                                style = MaterialTheme.typography.titleMedium,
                                color = Ink,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                if (paired) {
                                    "Este teléfono ya puede generar códigos."
                                } else {
                                    "Solo se hace una vez."
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = Slate,
                            )
                        }
                    }

                    if (!paired) {
                        Spacer(Modifier.height(18.dp))
                        if (state.pairingCode == null) {
                            Text(
                                "Pulsa el botón para generar un código. Luego ábrelo en SirpefOffice Token y pégalo allí.",
                                style = MaterialTheme.typography.bodySmall,
                                color = Slate,
                            )
                            Spacer(Modifier.height(14.dp))
                            Button(
                                onClick = onStartTokenPairing,
                                enabled = !state.tokenBusy,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(52.dp),
                                shape = RoundedCornerShape(16.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Indigo),
                            ) {
                                if (state.tokenBusy) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(20.dp),
                                        strokeWidth = 2.dp,
                                        color = White,
                                    )
                                } else {
                                    Text("Generar código de vinculación", fontWeight = FontWeight.Bold)
                                }
                            }
                        } else {
                            Text(
                                "Código de vinculación",
                                style = MaterialTheme.typography.labelSmall,
                                color = Slate,
                            )
                            Spacer(Modifier.height(8.dp))
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFFF7F9FC), RoundedCornerShape(16.dp))
                                    .border(1.dp, Color(0xFFE3E4E8), RoundedCornerShape(16.dp))
                                    .padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    state.pairingCode,
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontFamily = FontFamily.Monospace,
                                    color = Ink,
                                    letterSpacing = 3.sp,
                                    modifier = Modifier.weight(1f),
                                )
                                TextButton(
                                    onClick = {
                                        clipboard.setPrimaryClip(
                                            ClipData.newPlainText(
                                                "Código de Token",
                                                state.pairingCode,
                                            ),
                                        )
                                    },
                                ) {
                                    Icon(Icons.Outlined.ContentCopy, contentDescription = "Copiar")
                                }
                            }
                            Spacer(Modifier.height(12.dp))
                            Button(
                                onClick = {
                                    val intent = context.packageManager
                                        .getLaunchIntentForPackage(
                                            "ve.gob.mppef.sirpefoffice.token",
                                        )
                                    if (intent != null) context.startActivity(intent)
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(50.dp),
                                shape = RoundedCornerShape(16.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Ink),
                            ) {
                                Icon(Icons.Outlined.OpenInNew, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text("Abrir SirpefOffice Token", fontWeight = FontWeight.Bold)
                            }
                            Spacer(Modifier.height(14.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = Indigo,
                                )
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    "Esperando vinculación…",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Slate,
                                )
                            }
                        }
                    } else {
                        Spacer(Modifier.height(18.dp))
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color(0xFFE7F4E8), RoundedCornerShape(14.dp))
                                .padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Outlined.Shield, contentDescription = null, tint = Success)
                            Spacer(Modifier.width(10.dp))
                            Text(
                                "Token activo. El siguiente paso es guardar tus códigos de recuperación.",
                                style = MaterialTheme.typography.bodySmall,
                                color = Ink,
                            )
                        }
                        Spacer(Modifier.height(16.dp))
                        Button(
                            onClick = onContinue,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(52.dp),
                            shape = RoundedCornerShape(16.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Indigo),
                        ) {
                            Text("Continuar", fontWeight = FontWeight.Bold)
                        }
                    }

                    if (state.error != null) {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            state.error,
                            color = Danger,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RecoveryOnboardingScreen(
    state: UiState,
    confirmed: Boolean,
    onConfirmed: (Boolean) -> Unit,
    onGenerate: () -> Unit,
    onFinish: () -> Unit,
) {
    val context = LocalContext.current
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Background),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(20.dp),
        ) {
            Text(
                "Guarda tus códigos de recuperación",
                style = MaterialTheme.typography.headlineSmall,
                color = Ink,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Si pierdes el teléfono o el Token, estos códigos te permiten volver a entrar. Se muestran una sola vez.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )

            Spacer(Modifier.height(16.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFFEF4E6), RoundedCornerShape(14.dp))
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Shield, contentDescription = null, tint = Warning)
                Spacer(Modifier.width(10.dp))
                Text(
                    "Guárdalos fuera de este teléfono. No los compartas.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Ink,
                )
            }

            Spacer(Modifier.height(18.dp))
            if (state.recoveryCodes.isEmpty()) {
                Text(
                    "Genera los códigos ahora. Se mostrarán una sola vez.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate,
                )
                Spacer(Modifier.height(14.dp))
                Button(
                    onClick = onGenerate,
                    enabled = !state.tokenBusy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Indigo),
                ) {
                    if (state.tokenBusy) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = White,
                        )
                    } else {
                        Text("Generar códigos de recuperación", fontWeight = FontWeight.Bold)
                    }
                }
            } else {
                state.recoveryCodes.forEach { code ->
                    Text(
                        code,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .background(White, RoundedCornerShape(12.dp))
                            .border(1.dp, Color(0xFFE3E4E8), RoundedCornerShape(12.dp))
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        fontFamily = FontFamily.Monospace,
                        color = Ink,
                        textAlign = TextAlign.Center,
                    )
                }

                Spacer(Modifier.height(12.dp))
                TextButton(
                    onClick = {
                        clipboard.setPrimaryClip(
                            ClipData.newPlainText(
                                "Códigos de recuperación",
                                state.recoveryCodes.joinToString("\n"),
                            ),
                        )
                    },
                ) {
                    Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("Copiar todos")
                }

                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = confirmed,
                        onCheckedChange = onConfirmed,
                        colors = CheckboxDefaults.colors(checkedColor = Indigo),
                    )
                    Text(
                        "He guardado mis códigos en un lugar seguro.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Ink,
                    )
                }

                Spacer(Modifier.height(14.dp))
                Button(
                    onClick = onFinish,
                    enabled = confirmed && !state.loading,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Indigo),
                ) {
                    if (state.loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = White,
                        )
                    } else {
                        Text("Entrar a la bóveda", fontWeight = FontWeight.Bold)
                    }
                }
            }

            if (state.error != null) {
                Spacer(Modifier.height(12.dp))
                Text(state.error, color = Danger, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
