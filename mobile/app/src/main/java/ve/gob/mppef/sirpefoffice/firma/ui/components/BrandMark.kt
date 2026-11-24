package ve.gob.mppef.sirpefoffice.firma.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandBlue
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandMint
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandNavyDeep
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandNavySoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SourceSans
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White

/**
 * Monograma de SirpefOffice: S blanca sobre navy, borde azul y punto mint.
 */
@Composable
fun BrandMark(
    size: Dp = 40.dp,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .size(size)
            .background(
                Brush.linearGradient(listOf(BrandBlue, BrandNavySoft)),
                RoundedCornerShape(size * 0.34f),
            )
            .padding(1.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(BrandNavyDeep, RoundedCornerShape(size * 0.30f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "S",
                color = White,
                fontFamily = SourceSans,
                fontWeight = FontWeight.ExtraBold,
                fontSize = (size.value * 0.42f).sp,
            )
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = size * 0.12f, bottom = size * 0.12f)
                    .size(size * 0.13f)
                    .background(BrandMint, CircleShape),
            )
        }
    }
}
