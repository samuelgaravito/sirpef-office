package ve.gob.mppef.sirpefoffice.firma.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.OpenInFull
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ve.gob.mppef.sirpefoffice.firma.data.SignatureCapture
import ve.gob.mppef.sirpefoffice.firma.data.StrokePayload
import ve.gob.mppef.sirpefoffice.firma.data.strokesToCapture
import ve.gob.mppef.sirpefoffice.firma.data.typedSignatureCapture
import ve.gob.mppef.sirpefoffice.firma.R
import androidx.core.content.res.ResourcesCompat
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Danger
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SignatureBlue
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SignatureIndigo
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SignatureInk
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SurfaceSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Caveat

@Composable
fun SignatureDialog(
    userName: String,
    onDismiss: () -> Unit,
    onConfirm: (SignatureCapture) -> Unit,
) {
    var mode by rememberSaveable { mutableStateOf("draw") }
    var color by rememberSaveable { mutableStateOf(SignatureInk.toArgb()) }
    var strokes by remember { mutableStateOf(listOf<StrokePayload>()) }
    var typedName by rememberSaveable { mutableStateOf(userName) }
    var wide by rememberSaveable { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val caveatTypeface = remember(context) {
        ResourcesCompat.getFont(context, R.font.caveat)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = White,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Crear firma",
                            style = MaterialTheme.typography.titleLarge,
                            color = Ink,
                            fontWeight = FontWeight.ExtraBold,
                        )
                        Text(
                            "Elige cómo deseas firmar el documento.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate,
                        )
                    }
                    IconButton(onClick = { wide = !wide }) {
                        Icon(
                            Icons.Outlined.OpenInFull,
                            contentDescription = "Ampliar lienzo",
                            tint = Indigo,
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Outlined.Close, contentDescription = "Cerrar", tint = Slate)
                    }
                }

                Spacer(Modifier.height(16.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(SurfaceSoft, RoundedCornerShape(14.dp))
                        .padding(4.dp),
                ) {
                    ModeButton(
                        text = "Dibujar",
                        active = mode == "draw",
                        modifier = Modifier.weight(1f),
                    ) { mode = "draw" }
                    ModeButton(
                        text = "Automática",
                        active = mode == "type",
                        modifier = Modifier.weight(1f),
                    ) { mode = "type" }
                }

                Spacer(Modifier.height(14.dp))

                if (mode == "draw") {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(if (wide) 360.dp else 240.dp)
                            .background(Color(0xFFF7F9FC), RoundedCornerShape(20.dp))
                            .padding(6.dp),
                    ) {
                        SignaturePad(
                            strokes = strokes,
                            onStroke = { strokes = strokes + it },
                            color = color,
                            modifier = Modifier.fillMaxSize(),
                        )
                        Text(
                            "Firma dentro del recuadro",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFF667085),
                            modifier = Modifier
                                .align(Alignment.BottomStart)
                                .padding(start = 14.dp, bottom = 8.dp),
                        )
                    }

                    Spacer(Modifier.height(14.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Tinta",
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate,
                        )
                        Spacer(Modifier.width(10.dp))
                        InkDot(SignatureInk) { color = SignatureInk.toArgb() }
                        InkDot(SignatureBlue) { color = SignatureBlue.toArgb() }
                        InkDot(SignatureIndigo) { color = SignatureIndigo.toArgb() }
                        Spacer(Modifier.weight(1f))
                        Surface(
                            color = Color(0xFFFDECEB),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.clickable {
                                strokes = emptyList()
                                localError = null
                            },
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    Icons.Outlined.DeleteOutline,
                                    contentDescription = null,
                                    tint = Danger,
                                    modifier = Modifier.size(16.dp),
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    "Limpiar",
                                    color = Danger,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                } else {
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(190.dp),
                        shape = RoundedCornerShape(20.dp),
                        color = Color(0xFFF7F9FC),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(
                                typedName.ifBlank { userName },
                                fontFamily = Caveat,
                                fontSize = 42.sp,
                                color = SignatureInk,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(20.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(14.dp))
                    OutlinedTextField(
                        value = typedName,
                        onValueChange = { typedName = it },
                        label = { Text("Nombre de la firma") },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "La firma tipográfica se registra como una rúbrica estilizada.",
                        style = MaterialTheme.typography.labelSmall,
                        color = Slate,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }

                if (localError != null) {
                    Text(
                        localError!!,
                        color = Danger,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }

                Spacer(Modifier.height(18.dp))
                Button(
                    onClick = {
                        val capture = if (mode == "draw") {
                            if (strokes.isEmpty()) {
                                localError = "Dibuja tu firma antes de continuar."
                                return@Button
                            }
                            strokesToCapture(strokes)
                        } else {
                            if (typedName.isBlank()) {
                                localError = "Escribe el nombre de la firma."
                                return@Button
                            }
                            typedSignatureCapture(typedName.trim(), typeface = caveatTypeface)
                        }
                        onConfirm(capture)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Indigo),
                ) {
                    Text("Estampar firma", fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(10.dp))
                Text(
                    "Al continuar se pedirá tu huella para desbloquear la clave del dispositivo.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Slate,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun ModeButton(
    text: String,
    active: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .background(if (active) White else Color.Transparent, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = if (active) Ink else Slate,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
        )
    }
}

@Composable
private fun InkDot(color: Color, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .padding(end = 9.dp)
            .size(22.dp)
            .background(color, CircleShape)
            .clickable(onClick = onClick),
    )
}
