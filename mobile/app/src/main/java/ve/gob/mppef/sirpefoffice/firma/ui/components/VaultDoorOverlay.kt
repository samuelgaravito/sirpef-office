package ve.gob.mppef.sirpefoffice.firma.ui.components

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandMint
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White

/**
 * Transición de entrada a la bóveda: una puerta circular metálica gira sobre
 * su bisagra y deja ver el inicio. Se usa al terminar el onboarding y en cada
 * login diario.
 */
@Composable
fun VaultDoorOverlay(onFinished: () -> Unit) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val progress = remember { Animatable(0f) }
    var finished by remember { mutableStateOf(false) }
    val reduceMotion = remember {
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }

    fun finish() {
        if (finished) return
        finished = true
        onFinished()
    }

    LaunchedEffect(Unit) {
        if (reduceMotion) {
            delay(180)
            finish()
            return@LaunchedEffect
        }
        progress.animateTo(
            1f,
            tween(1550, easing = FastOutSlowInEasing),
        )
        finish()
    }

    LaunchedEffect(Unit) {
        if (reduceMotion) return@LaunchedEffect
        delay(700)
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
    }

    val p = progress.value
    val wheel = ((p - 0.10f) / 0.38f).coerceIn(0f, 1f)
    val bolts = ((p - 0.18f) / 0.32f).coerceIn(0f, 1f)
    val open = ((p - 0.48f) / 0.52f).coerceIn(0f, 1f)
    val overlayAlpha = 1f - ((p - 0.82f) / 0.18f).coerceIn(0f, 1f)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer { alpha = overlayAlpha }
            .background(
                Brush.radialGradient(
                    listOf(Color(0xFF0C2A52), Color(0xFF02152E)),
                ),
            )
            .pointerInput(Unit) {
                detectTapGestures {
                    if (progress.value > 0.35f) finish()
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        // Luz mint que sale de la bóveda al abrirse.
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(
                        BrandMint.copy(alpha = 0.28f * open),
                        Color.Transparent,
                    ),
                ),
                radius = size.minDimension * 0.72f,
                center = center,
            )
        }

        Box(
            modifier = Modifier
                .size(310.dp)
                .graphicsLayer {
                    rotationY = -105f * open
                    transformOrigin = TransformOrigin(0f, 0.5f)
                    cameraDistance = 18f * density
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val center = this.center
                val radius = size.minDimension / 2f

                // Sombra y marco.
                drawCircle(
                    color = Color(0x99000000),
                    radius = radius * 1.03f,
                    center = center,
                )

                // Metal de la puerta.
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            Color(0xFF3A5F8C),
                            Color(0xFF142E50),
                            Color(0xFF06182E),
                        ),
                        center = Offset(radius * 0.6f, radius * 0.6f),
                        radius = radius * 1.4f,
                    ),
                    radius = radius,
                    center = center,
                )
                drawCircle(
                    color = Color(0xFF3C6FB0),
                    radius = radius,
                    center = center,
                    style = Stroke(width = 4.dp.toPx()),
                )
                drawCircle(
                    color = Color(0xFF0B1F3A),
                    radius = radius * 0.86f,
                    center = center,
                )
                drawCircle(
                    color = Color(0x553C6FB0),
                    radius = radius * 0.62f,
                    center = center,
                    style = Stroke(width = 2.dp.toPx()),
                )

                // Pernos que se retraen al girar el volante.
                repeat(8) { index ->
                    val angle = Math.PI * 2.0 * index / 8.0
                    val distance = radius * (0.74f - bolts * 0.13f)
                    val x = center.x + (Math.cos(angle) * distance).toFloat()
                    val y = center.y + (Math.sin(angle) * distance).toFloat()
                    drawCircle(
                        color = Color(0xFFB7CFE6),
                        radius = 5.5.dp.toPx(),
                        center = Offset(x, y),
                    )
                    drawCircle(
                        color = Color(0xFF02152E),
                        radius = 2.5.dp.toPx(),
                        center = Offset(x, y),
                    )
                }

                // Volante de tres radios.
                rotate(degrees = wheel * 190f, pivot = center) {
                    repeat(3) { index ->
                        val angle = Math.PI * 2.0 * index / 3.0
                        val end = Offset(
                            center.x + (Math.cos(angle) * radius * 0.58f).toFloat(),
                            center.y + (Math.sin(angle) * radius * 0.58f).toFloat(),
                        )
                        drawLine(
                            color = Color(0xFFD9E8F8),
                            start = center,
                            end = end,
                            strokeWidth = 7.dp.toPx(),
                            cap = androidx.compose.ui.graphics.StrokeCap.Round,
                        )
                        drawCircle(
                            color = Color(0xFF3C6FB0),
                            radius = 8.dp.toPx(),
                            center = end,
                        )
                    }
                    drawCircle(
                        color = Color(0xFFE9F1FA),
                        radius = radius * 0.12f,
                        center = center,
                    )
                    drawCircle(
                        color = Color(0xFF1B3A66),
                        radius = radius * 0.075f,
                        center = center,
                    )
                }

                // Aro mint de energía.
                drawCircle(
                    color = BrandMint.copy(alpha = 0.18f + 0.5f * open),
                    radius = radius * 0.985f,
                    center = center,
                    style = Stroke(width = 2.dp.toPx()),
                )
            }
        }

        Text(
            "Abriendo la bóveda",
            color = White.copy(alpha = 0.78f),
            style = MaterialTheme.typography.labelSmall,
            letterSpacing = 2.4.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 96.dp),
        )
    }
}
