package ve.gob.mppef.sirpefoffice.firma.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ve.gob.mppef.sirpefoffice.firma.R

/**
 * Logo de SirpefOffice Firma: documento con pluma y ondas de firma.
 */
@Composable
fun BrandMark(
    size: Dp = 40.dp,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(size * 0.28f)
    Box(
        modifier = modifier
            .requiredSize(size)
            .clip(shape)
            .background(Color.White)
            .border(1.dp, Color.White.copy(alpha = 0.18f), shape),
    ) {
        Image(
            painter = painterResource(R.drawable.brand_firma),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}
