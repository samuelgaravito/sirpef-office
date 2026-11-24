package ve.gob.mppef.sirpefoffice.firma.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import ve.gob.mppef.sirpefoffice.firma.data.PointPayload
import ve.gob.mppef.sirpefoffice.firma.data.StrokePayload

@Composable
fun SignaturePad(
    strokes: List<StrokePayload>,
    onStroke: (StrokePayload) -> Unit,
    color: Int,
    modifier: Modifier = Modifier,
) {
    var current by remember { mutableStateOf<StrokePayload?>(null) }

    Canvas(
        modifier = modifier
            .fillMaxSize()
            .pointerInput(color) {
                detectDragGestures(
                    onDragStart = { offset ->
                        current = StrokePayload(
                            points = listOf(normalize(offset, size.width, size.height)),
                            color = color,
                            width = 4f,
                        )
                    },
                    onDrag = { change, _ ->
                        change.consume()
                        val stroke = current ?: return@detectDragGestures
                        current = stroke.copy(
                            points = stroke.points + normalize(
                                change.position,
                                size.width,
                                size.height,
                            ),
                        )
                    },
                    onDragEnd = {
                        current?.let(onStroke)
                        current = null
                    },
                    onDragCancel = { current = null },
                )
            },
    ) {
        val baselineY = size.height * 0.78f
        drawLine(
            color = Color(0xFFB5B6BB),
            start = Offset(size.width * 0.08f, baselineY),
            end = Offset(size.width * 0.92f, baselineY),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f)),
        )
        drawLine(
            color = Color(0xFF667085),
            start = Offset(size.width * 0.90f, baselineY - 10.dp.toPx()),
            end = Offset(size.width * 0.90f, baselineY + 10.dp.toPx()),
            strokeWidth = 1.dp.toPx(),
        )

        val all = if (current != null) strokes + current!! else strokes
        for (stroke in all) {
            if (stroke.points.isEmpty()) continue
            val path = Path()
            val first = stroke.points.first()
            path.moveTo(first.x * size.width, first.y * size.height)
            for (point in stroke.points.drop(1)) {
                path.lineTo(point.x * size.width, point.y * size.height)
            }
            drawPath(
                path = path,
                color = Color(stroke.color),
                style = Stroke(
                    width = stroke.width.dp.toPx(),
                    cap = StrokeCap.Round,
                    join = StrokeJoin.Round,
                ),
            )
        }
    }
}

private fun normalize(offset: Offset, width: Int, height: Int): PointPayload {
    if (width <= 0 || height <= 0) return PointPayload(0f, 0f)
    return PointPayload(
        x = (offset.x / width).coerceIn(0f, 1f),
        y = (offset.y / height).coerceIn(0f, 1f),
    )
}
