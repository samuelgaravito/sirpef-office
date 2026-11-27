package ve.gob.mppef.sirpefoffice.firma.ui.screens

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ve.gob.mppef.sirpefoffice.firma.data.MobileDocument
import ve.gob.mppef.sirpefoffice.firma.ui.DocumentFilter
import ve.gob.mppef.sirpefoffice.firma.ui.UiState
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Background
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Danger
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.firma.ui.theme.InkSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SlateLight
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Success
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandMint
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SuccessSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Violet
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Warning
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White
import ve.gob.mppef.sirpefoffice.firma.ui.components.BrandMark
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun HomeScreen(
    state: UiState,
    onFilter: (DocumentFilter) -> Unit,
    onSearch: (String) -> Unit,
    onRefresh: () -> Unit,
    onPage: (Int) -> Unit,
    onDocument: (MobileDocument) -> Unit,
    onProfile: () -> Unit,
) {
    val context = LocalContext.current
    val user = state.user
    val listState = rememberLazyListState()
    val focusManager = LocalFocusManager.current
    val density = LocalDensity.current

    // El buscador enfocado colapsa la cabecera: saludo y métricas se pliegan.
    var searchFocused by remember { mutableStateOf(false) }
    val compact = searchFocused

    val imeVisible = WindowInsets.ime.getBottom(density) > 0
    val dockVisible = !compact && !imeVisible
    val navigationBars = with(density) {
        WindowInsets.navigationBars.getBottom(this).toDp()
    }

    // Cada cambio de página vuelve al inicio de la lista, como una hoja nueva.
    LaunchedEffect(state.page) {
        if (listState.firstVisibleItemIndex > 0) {
            listState.animateScrollToItem(0)
        }
    }

    // Al entrar en modo búsqueda la cabecera se pega arriba antes de plegarse.
    LaunchedEffect(compact) {
        if (compact && listState.firstVisibleItemIndex > 0) {
            listState.animateScrollToItem(0)
        }
    }

    // Si el sistema oculta el teclado con el campo aún enfocado (botón atrás del
    // IME o gesto de navegación), salimos del modo búsqueda para no dejar la
    // cabecera colapsada sin teclado.
    var imeWasVisible by remember { mutableStateOf(false) }
    LaunchedEffect(imeVisible) {
        if (imeVisible) {
            imeWasVisible = true
        } else if (imeWasVisible && searchFocused) {
            imeWasVisible = false
            focusManager.clearFocus()
        }
    }

    BackHandler(enabled = searchFocused) { focusManager.clearFocus() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Background),
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .imePadding(),
            contentPadding = PaddingValues(
                // La última tarjeta queda por encima del dock y del círculo central.
                bottom = if (dockVisible) navigationBars + 120.dp else 24.dp,
            ),
        ) {
            item {
                // Cabecera y filtros comparten el mismo ítem: así el LazyColumn
                // no puede medir los filtros contra el alto restante ni dejar
                // un hueco entre la cabecera y las tarjetas.
                Column {
                    VaultHeader(
                        name = user?.name ?: "Usuario",
                        role = user?.role ?: "member",
                        pending = state.counts.pending,
                        received = state.counts.received,
                        signed = state.counts.signed,
                        search = state.search,
                        loading = state.loading,
                        compact = compact,
                        onSearch = onSearch,
                        onSearchFocusChanged = { searchFocused = it },
                        onRefresh = onRefresh,
                        onPending = { onFilter(DocumentFilter.PENDING) },
                        onReceived = { onFilter(DocumentFilter.RECEIVED) },
                        onSigned = { onFilter(DocumentFilter.SIGNED) },
                    )
                    if (!compact) {
                        FilterRow(
                            selected = state.filter,
                            onFilter = onFilter,
                        )
                    }
                }
            }

            if (state.loading && state.documents.isEmpty()) {
                item {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .padding(40.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(color = Indigo)
                    }
                }
            }

            items(state.documents, key = { it.id }) { document ->
                DocumentCard(
                    document = document,
                    onClick = { onDocument(document) },
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 5.dp),
                )
            }

            if (!state.loading && state.documents.isEmpty()) {
                item {
                    EmptyDocuments(state.filter)
                }
            }

            if (state.pageCount > 1) {
                item(key = "paginador") {
                    DocumentPager(
                        page = state.page,
                        pageCount = state.pageCount,
                        loading = state.pageLoading,
                        onPage = onPage,
                    )
                }
            }
        }

        if (dockVisible) {
            HomeDock(
                onDocuments = { onFilter(DocumentFilter.ALL) },
                onAdd = {
                    Toast.makeText(
                        context,
                        "La importación de PDFs llegará en la próxima versión.",
                        Toast.LENGTH_SHORT,
                    ).show()
                },
                onProfile = onProfile,
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
    }
}

@Composable
private fun VaultHeader(
    name: String,
    role: String,
    pending: Int,
    received: Int,
    signed: Int,
    search: String,
    loading: Boolean,
    compact: Boolean,
    onSearch: (String) -> Unit,
    onSearchFocusChanged: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    onPending: () -> Unit,
    onReceived: () -> Unit,
    onSigned: () -> Unit,
) {
    val focusManager = LocalFocusManager.current
    val verticalPadding by animateDpAsState(
        targetValue = if (compact) 10.dp else 18.dp,
        label = "cabecera-vertical",
    )
    val enter = expandVertically(
        animationSpec = tween(220),
        expandFrom = Alignment.Top,
    ) + fadeIn(animationSpec = tween(180))
    val exit = shrinkVertically(
        animationSpec = tween(220),
        shrinkTowards = Alignment.Top,
    ) + fadeOut(animationSpec = tween(120))

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF02152E), Ink, InkSoft),
                ),
                RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp),
            )
            .statusBarsPadding()
            .padding(horizontal = 20.dp)
            .padding(vertical = verticalPadding),
    ) {
        Column {
            AnimatedVisibility(visible = !compact, enter = enter, exit = exit) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        BrandMark(size = 44.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    "Hola, ${name.substringBefore(' ')}",
                                    color = Color(0xFFB5B6BB),
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Spacer(Modifier.width(6.dp))
                                Surface(
                                    color = BrandMint.copy(alpha = 0.15f),
                                    shape = RoundedCornerShape(6.dp),
                                ) {
                                    Text(
                                        if (role == "admin") "ADMIN" else "SVA",
                                        color = BrandMint,
                                        style = MaterialTheme.typography.labelSmall,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                    )
                                }
                            }
                            Text(
                                "Bóveda de Firmas",
                                color = White,
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.ExtraBold,
                            )
                            Text(
                                "SIRPEF · GESTIÓN DOCUMENTAL",
                                color = Color(0xFF9DB9D8),
                                style = MaterialTheme.typography.labelSmall,
                                letterSpacing = 1.4.sp,
                            )
                        }
                        IconButton(onClick = onRefresh) {
                            Icon(
                                Icons.Outlined.Refresh,
                                contentDescription = "Actualizar",
                                tint = if (loading) Color(0xFF9DB9D8) else Color(0xFFE3E4E8),
                            )
                        }
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(14.dp))
                                .clickable(onClick = onReceived),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Outlined.NotificationsNone,
                                contentDescription = "Documentos recibidos",
                                tint = Color(0xFFE3E4E8),
                                modifier = Modifier.size(20.dp),
                            )
                            if (received > 0) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .padding(top = 5.dp, end = 5.dp)
                                        .background(Danger, CircleShape)
                                        .padding(horizontal = 4.dp, vertical = 1.dp),
                                ) {
                                    Text(
                                        if (received > 99) "99+" else received.toString(),
                                        color = White,
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = FontWeight.Bold,
                                    )
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(18.dp))
                }
            }

            TextField(
                value = search,
                onValueChange = onSearch,
                placeholder = {
                    Text(
                        "Buscar asunto, remitente o número…",
                        color = Color(0xFF9DB9D8),
                        style = MaterialTheme.typography.bodySmall,
                    )
                },
                leadingIcon = {
                    Icon(
                        Icons.Outlined.Search,
                        contentDescription = null,
                        tint = Color(0xFF9DB9D8),
                        modifier = Modifier.size(18.dp),
                    )
                },
                trailingIcon = if (search.isNotEmpty()) {
                    {
                        IconButton(onClick = { onSearch("") }) {
                            Icon(
                                Icons.Outlined.Close,
                                contentDescription = "Limpiar búsqueda",
                                tint = Color(0xFF9DB9D8),
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                } else {
                    null
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { focusManager.clearFocus() }),
                shape = RoundedCornerShape(16.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.White.copy(alpha = 0.12f),
                    unfocusedContainerColor = Color.White.copy(alpha = 0.09f),
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    focusedTextColor = White,
                    unfocusedTextColor = White,
                    cursorColor = White,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .onFocusChanged { onSearchFocusChanged(it.isFocused) },
            )

            AnimatedVisibility(visible = !compact, enter = enter, exit = exit) {
                Column {
                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        MetricCard(
                            title = "Acción requerida",
                            value = pending,
                            caption = "pendientes",
                            colors = listOf(Indigo, Violet),
                            icon = {
                                Icon(
                                    Icons.Outlined.Description,
                                    contentDescription = null,
                                    tint = White,
                                    modifier = Modifier.size(16.dp),
                                )
                            },
                            modifier = Modifier
                                .weight(1f)
                                .clickable(onClick = onPending),
                        )
                        MetricCard(
                            title = "Completados",
                            value = signed,
                            caption = "verificados",
                            colors = listOf(
                                Color.White.copy(alpha = 0.12f),
                                Color.White.copy(alpha = 0.07f),
                            ),
                            icon = {
                                Icon(
                                    Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    tint = BrandMint,
                                    modifier = Modifier.size(16.dp),
                                )
                            },
                            modifier = Modifier
                                .weight(1f)
                                .clickable(onClick = onSigned),
                            valueColor = White,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricCard(
    title: String,
    value: Int,
    caption: String,
    colors: List<Color>,
    icon: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    valueColor: Color = White,
) {
    Box(
        modifier = modifier
            .background(Brush.linearGradient(colors), RoundedCornerShape(18.dp))
            .padding(14.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    color = Color(0xFFE9F1FA),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .background(Color.White.copy(alpha = 0.16f), RoundedCornerShape(10.dp)),
                    contentAlignment = Alignment.Center,
                ) { icon() }
            }
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    value.toString(),
                    color = valueColor,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.ExtraBold,
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    caption,
                    color = Color(0xFFB7CFE6),
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(bottom = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun FilterRow(
    selected: DocumentFilter,
    onFilter: (DocumentFilter) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            color = Color(0xFFE3E4E8),
            shape = RoundedCornerShape(14.dp),
        ) {
            Row(
                Modifier
                    .padding(4.dp)
                    .horizontalScroll(rememberScrollState()),
            ) {
                DocumentFilter.entries.forEach { filter ->
                    val active = filter == selected
                    Box(
                        modifier = Modifier
                            .background(
                                if (active) White else Color.Transparent,
                                RoundedCornerShape(10.dp),
                            )
                            .clickable { onFilter(filter) }
                            .padding(horizontal = 14.dp, vertical = 7.dp),
                    ) {
                        Text(
                            filter.label,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                            color = if (active) Ink else Slate,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Text(
            "Mis documentos",
            style = MaterialTheme.typography.bodySmall,
            color = Slate,
        )
    }
}

@Composable
private fun DocumentCard(
    document: MobileDocument,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val pending = !document.signed && (document.status == "pending_approval" || document.needsSignature)
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(20.dp),
        color = White,
        tonalElevation = 0.dp,
        shadowElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(46.dp)
                    .background(
                        if (pending) Color(0xFFE9F1FA) else SuccessSoft,
                        RoundedCornerShape(16.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (document.signed) Icons.Outlined.CheckCircle else Icons.Outlined.Description,
                    contentDescription = null,
                    tint = if (document.signed) Success else Indigo,
                    modifier = Modifier.size(22.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        color = if (pending) Color(0xFFFEF4E6) else Color(0xFFF6F5F7),
                        shape = RoundedCornerShape(5.dp),
                    ) {
                        Text(
                            when {
                                document.annulled -> "ANULADO"
                                document.signed -> "FIRMADO"
                                pending -> "POR FIRMAR"
                                else -> "ENVIADO"
                            },
                            color = if (pending) Color(0xFFB45309) else Slate,
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
                        )
                    }
                    Spacer(Modifier.width(6.dp))
                    Text(
                        formatDate(document.createdAt),
                        color = Slate,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    document.title,
                    color = Ink,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    document.subject.ifBlank { document.senderName },
                    color = Slate,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(8.dp))
            if (pending && (document.canSign || document.needsSignature)) {
                Surface(
                    color = Ink,
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(
                        "Firmar",
                        color = White,
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            } else if (document.signed) {
                Icon(
                    Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    tint = Success,
                    modifier = Modifier.size(24.dp),
                )
            }
        }
    }
}

@Composable
private fun EmptyDocuments(filter: DocumentFilter) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 20.dp),
        shape = RoundedCornerShape(20.dp),
        color = White,
    ) {
        Column(
            modifier = Modifier.padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                Icons.Outlined.Description,
                contentDescription = null,
                tint = SlateLight,
                modifier = Modifier.size(34.dp),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                when (filter) {
                    DocumentFilter.PENDING -> "No tienes envíos pendientes de aprobación."
                    DocumentFilter.RECEIVED -> "No has recibido documentos todavía."
                    DocumentFilter.SIGNED -> "Todavía no has firmado documentos."
                    DocumentFilter.ALL -> "No se encontraron documentos."
                },
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )
        }
    }
}

@Composable
private fun DocumentPager(
    page: Int,
    pageCount: Int,
    loading: Boolean,
    onPage: (Int) -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 12.dp),
        shape = RoundedCornerShape(20.dp),
        color = White,
        shadowElevation = 1.dp,
    ) {
        Column {
            if (loading) {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(2.dp),
                    color = Indigo,
                    trackColor = Color.Transparent,
                )
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PagerArrow(
                    forward = false,
                    enabled = page > 1 && !loading,
                ) { onPage(page - 1) }

                pagerSlots(page, pageCount).forEach { slot ->
                    when (slot) {
                        null -> Text(
                            "…",
                            color = SlateLight,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(horizontal = 2.dp),
                        )

                        else -> PagerNumber(
                            number = slot,
                            active = slot == page,
                            enabled = !loading,
                        ) { onPage(slot) }
                    }
                }

                PagerArrow(
                    forward = true,
                    enabled = page < pageCount && !loading,
                ) { onPage(page + 1) }
            }
        }
    }
}

@Composable
private fun PagerArrow(
    forward: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val label = if (forward) "Página siguiente" else "Página anterior"
    Box(
        modifier = Modifier
            .size(width = 38.dp, height = 40.dp)
            .clip(CircleShape)
            .clickable(enabled = enabled, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (forward) Icons.Outlined.ChevronRight else Icons.Outlined.ChevronLeft,
            contentDescription = null,
            tint = if (enabled) Ink else SlateLight,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun PagerNumber(
    number: Int,
    active: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(width = 36.dp, height = 40.dp)
            .clip(CircleShape)
            .clickable(enabled = enabled && !active, onClick = onClick)
            .semantics {
                contentDescription = if (active) {
                    "Página $number, actual"
                } else {
                    "Ir a la página $number"
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(34.dp)
                .background(if (active) Ink else Color.Transparent, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                number.toString(),
                color = if (active) White else Slate,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
            )
        }
    }
}

/**
 * Números visibles del paginador: primera y última página siempre, y la
 * actual con sus vecinas. Los huecos se muestran como puntos suspensivos.
 */
private fun pagerSlots(page: Int, pageCount: Int): List<Int?> {
    if (pageCount <= 5) return (1..pageCount).toList()

    val slots = mutableListOf<Int?>()
    slots += 1

    val start = maxOf(2, page - 1)
    val end = minOf(pageCount - 1, page + 1)
    if (start > 2) slots += null
    for (number in start..end) slots += number
    if (end < pageCount - 1) slots += null

    slots += pageCount
    return slots
}

@Composable
private fun HomeDock(
    onDocuments: () -> Unit,
    onAdd: () -> Unit,
    onProfile: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(28.dp)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 18.dp)
            .padding(top = 24.dp, bottom = 10.dp),
    ) {
        // Barra «pill» semitransparente: el contenido se intuye por detrás.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(76.dp)
                .align(Alignment.BottomCenter)
                .shadow(
                    elevation = 18.dp,
                    shape = shape,
                    clip = false,
                    ambientColor = Color.Black.copy(alpha = 0.35f),
                    spotColor = Color.Black.copy(alpha = 0.45f),
                )
                .background(
                    Brush.verticalGradient(
                        listOf(
                            Color(0xFF0A2444).copy(alpha = 0.97f),
                            Color(0xFF061C38).copy(alpha = 0.97f),
                        ),
                    ),
                    shape,
                )
                .border(
                    width = 1.dp,
                    brush = Brush.verticalGradient(
                        listOf(White.copy(alpha = 0.18f), White.copy(alpha = 0.04f)),
                    ),
                    shape = shape,
                ),
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(76.dp)
                .align(Alignment.BottomCenter),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DockItem(
                label = "Documentos",
                icon = Icons.Outlined.Description,
                color = BrandMint,
                onClick = onDocuments,
                modifier = Modifier.weight(1f),
            )
            DockCenter(
                onClick = onAdd,
                modifier = Modifier.weight(1f),
            )
            DockItem(
                label = "Identidad",
                icon = Icons.Outlined.Fingerprint,
                color = Color(0xFF8FAFCB),
                onClick = onProfile,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun DockCenter(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.offset(y = (-18).dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(
            onClick = onClick,
            shape = CircleShape,
            color = White,
            shadowElevation = 10.dp,
            modifier = Modifier.size(54.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Outlined.Add,
                    contentDescription = "Añadir documento",
                    tint = Indigo,
                    modifier = Modifier.size(26.dp),
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            "Añadir",
            color = White,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun DockItem(
    label: String,
    icon: ImageVector,
    color: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(18.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                icon,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.height(4.dp))
            Text(
                label,
                color = color,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

private fun formatDate(value: String?): String {
    if (value.isNullOrBlank()) return ""
    return try {
        val instant = Instant.parse(value)
        DateTimeFormatter.ofPattern("d MMM")
            .withZone(ZoneId.systemDefault())
            .format(instant)
    } catch (_: Exception) {
        value.take(10)
    }
}
