package ve.gob.mppef.sirpefoffice.token.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ve.gob.mppef.sirpefoffice.token.data.Totp
import ve.gob.mppef.sirpefoffice.token.ui.UiState
import ve.gob.mppef.sirpefoffice.token.ui.components.BrandMark
import ve.gob.mppef.sirpefoffice.token.ui.theme.Background
import ve.gob.mppef.sirpefoffice.token.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.token.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.token.ui.theme.InkSoft
import ve.gob.mppef.sirpefoffice.token.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.token.ui.theme.Success
import ve.gob.mppef.sirpefoffice.token.ui.theme.SuccessSoft
import ve.gob.mppef.sirpefoffice.token.ui.theme.White

@Composable
fun TokenScreen(
    state: UiState,
    onUnlock: () -> Unit,
    onProfile: () -> Unit,
    onRefresh: () -> Unit,
) {
    val context = LocalContext.current
    val material = state.material

    Box(Modifier.fillMaxSize().background(Background)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.linearGradient(listOf(Color(0xFF02152E), Ink, InkSoft)))
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(horizontal = 22.dp, vertical = 26.dp),
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        BrandMark(size = 44.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                "SirpefOffice Token",
                                color = White,
                                style = MaterialTheme.typography.titleLarge,
                            )
                            Text(
                                state.user?.name ?: "Usuario",
                                color = Color(0xFFB7CFE6),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        IconButton(onClick = onRefresh) {
                            Icon(
                                Icons.Outlined.Refresh,
                                contentDescription = "Actualizar estado",
                                tint = Color(0xFFB7CFE6),
                            )
                        }
                        IconButton(onClick = onProfile) {
                            Icon(
                                Icons.Outlined.Person,
                                contentDescription = "Perfil y seguridad",
                                tint = Color(0xFFB7CFE6),
                            )
                        }
                    }
                    Spacer(Modifier.height(18.dp))
                    Text(
                        "Código de autorización",
                        color = Color(0xFF9DB9D8),
                        style = MaterialTheme.typography.labelSmall,
                        letterSpacing = 1.6.sp,
                    )
                    Text(
                        "Úsalo en SirpefOffice Firma al sellar un documento.",
                        color = Color(0xFFB7CFE6),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            if (material == null) {
                LockedCard(loading = state.loading, onUnlock = onUnlock)
            } else {
                Spacer(Modifier.height(16.dp))
                Card(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    shape = RoundedCornerShape(28.dp),
                    colors = CardDefaults.cardColors(containerColor = White),
                    elevation = CardDefaults.cardElevation(defaultElevation = 3.dp),
                ) {
                    Column(
                        Modifier.padding(horizontal = 20.dp, vertical = 24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            "TOKEN DINÁMICO · 30 SEGUNDOS",
                            style = MaterialTheme.typography.labelSmall,
                            color = Slate,
                            letterSpacing = 1.2.sp,
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = state.code?.let { Totp.format(it) } ?: "— — —",
                            color = Ink,
                            fontSize = 42.sp,
                            fontWeight = FontWeight.ExtraBold,
                            fontFamily = FontFamily.Monospace,
                            letterSpacing = 4.sp,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Válido por ${state.remainingSeconds} s",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (state.remainingSeconds <= 5) Color(0xFFB45309) else Slate,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.height(14.dp))
                        LinearProgressIndicator(
                            progress = {
                                (state.remainingSeconds.toFloat() / material.period.coerceAtLeast(1))
                                    .coerceIn(0f, 1f)
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(8.dp),
                            color = if (state.remainingSeconds <= 5) Color(0xFFB45309) else Indigo,
                            trackColor = Color(0xFFE9F1FA),
                        )
                        Spacer(Modifier.height(18.dp))
                        Button(
                            onClick = {
                                val code = state.code ?: return@Button
                                copyCode(context, code)
                                Handler(Looper.getMainLooper()).postDelayed(
                                    { clearIfUnchanged(context, code) },
                                    45_000,
                                )
                            },
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                            shape = RoundedCornerShape(16.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Ink),
                        ) {
                            Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Copiar código", fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.height(8.dp))
                        Button(
                            onClick = {
                                val code = state.code ?: return@Button
                                copyCode(context, code)
                                Handler(Looper.getMainLooper()).postDelayed(
                                    { clearIfUnchanged(context, code) },
                                    45_000,
                                )
                                val intent = context.packageManager
                                    .getLaunchIntentForPackage(FIRMA_PACKAGE)
                                if (intent == null) {
                                    Toast.makeText(
                                        context,
                                        "SirpefOffice Firma no está instalada. El código quedó copiado.",
                                        Toast.LENGTH_LONG,
                                    ).show()
                                } else {
                                    intent.putExtra(EXTRA_TOTP_CODE, code)
                                    intent.putExtra(EXTRA_TOTP_REMAINING, state.remainingSeconds)
                                    intent.addFlags(
                                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                                            Intent.FLAG_ACTIVITY_SINGLE_TOP,
                                    )
                                    runCatching { context.startActivity(intent) }
                                        .onFailure {
                                            Toast.makeText(
                                                context,
                                                "No se pudo abrir SirpefOffice Firma. El código quedó copiado.",
                                                Toast.LENGTH_LONG,
                                            ).show()
                                        }
                                }
                            },
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                            shape = RoundedCornerShape(16.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color(0xFFE9F1FA),
                                contentColor = Ink,
                            ),
                        ) {
                            Icon(Icons.Outlined.OpenInNew, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Copiar y volver a Firma", fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Copia el código y vuelve a SirpefOffice Firma para autocompletarlo. " +
                                "El portapapeles se borra en 45 segundos.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate,
                        )
                    }
                }

                Card(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .padding(top = 14.dp),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = White),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                ) {
                    Column(Modifier.padding(18.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Outlined.Security,
                                contentDescription = null,
                                tint = Success,
                                modifier = Modifier.size(20.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "Protegido por biometría",
                                style = MaterialTheme.typography.titleSmall,
                                color = Ink,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Cuenta: ${material.account.ifBlank { state.user?.email ?: "" }}",
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate,
                        )
                        Text(
                            "Emisor: ${material.issuer} · ${material.digits} dígitos",
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate,
                        )
                        Spacer(Modifier.height(8.dp))
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = SuccessSoft.copy(alpha = 0.6f),
                        ) {
                            Text(
                                if (kotlin.math.abs(state.clockOffsetSeconds) <= 5) {
                                    "Hora sincronizada con el servidor"
                                } else {
                                    "Hora corregida ${if (state.clockOffsetSeconds >= 0) "+" else ""}${state.clockOffsetSeconds} s respecto al teléfono"
                                },
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = Color(0xFF026B04),
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }

                Text(
                    "Este código cambia cada 30 segundos. No lo compartas por teléfono ni por mensaje.",
                    modifier = Modifier.padding(horizontal = 26.dp, vertical = 18.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate,
                )
            }
        }
    }
}

@Composable
private fun LockedCard(loading: Boolean, onUnlock: () -> Unit) {
    Card(
        Modifier
            .fillMaxWidth()
            .padding(20.dp),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .size(64.dp)
                    .background(Color(0xFFE9F1FA), RoundedCornerShape(22.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Lock,
                    contentDescription = null,
                    tint = Indigo,
                    modifier = Modifier.size(30.dp),
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(
                "Token bloqueado",
                style = MaterialTheme.typography.titleLarge,
                color = Ink,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Confirma tu identidad para descifrar el secreto y generar el código.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = onUnlock,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Ink),
                enabled = !loading,
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.height(20.dp),
                        color = White,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("Desbloquear con biometría", fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "También se acepta el PIN o patrón del dispositivo.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )
        }
    }
}

private const val FIRMA_PACKAGE = "ve.gob.mppef.sirpefoffice.firma"
private const val EXTRA_TOTP_CODE = "ve.gob.mppef.sirpefoffice.extra.TOTP_CODE"
private const val EXTRA_TOTP_REMAINING = "ve.gob.mppef.sirpefoffice.extra.TOTP_REMAINING"

private fun copyCode(context: Context, code: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = ClipData.newPlainText("Código SirpefOffice Token", code)
    if (Build.VERSION.SDK_INT >= 33) {
        clip.description.extras = PersistableBundle().apply {
            putBoolean("android.content.extra.IS_SENSITIVE", true)
        }
    }
    clipboard.setPrimaryClip(clip)
}

private fun clearIfUnchanged(context: Context, code: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val current = clipboard.primaryClip?.getItemAt(0)?.text?.toString()
    if (current == code) {
        if (Build.VERSION.SDK_INT >= 28) {
            clipboard.clearPrimaryClip()
        } else {
            clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
        }
    }
}
