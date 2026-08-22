package ink.warrant.design

import ink.warrant.R
import ink.warrant.contract.JobStatus
import ink.warrant.contract.ProvenanceClass
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The theme, in two grounds, on Google's design language.
 *
 * This is a Material 3 surface: the M3 shape scale, M3 type roles, M3 state layers, and
 * Google's own neutral ramps — Gemini's dark, Workspace's light. Blue is the action colour
 * and nothing else on any screen is ever blue.
 *
 * Dark is the WORKSHOP, where the work happens. Light is the PAPER RECORD, which is what
 * survives. A screen is one or the other and never both at once — the same rule the web
 * stylesheet enforces with `.w-ground--work` / `.w-ground--paper`.
 *
 * Colour values come from [Tokens], which is generated from `design/tokens.json`. Nothing in
 * this file invents a colour; it only decides which token plays which role on which ground.
 */
enum class Ground { Work, Paper }

/** Google Sans Code, bundled. The web stack loads the same face — see design/tokens.json. */
private val GoogleSansCode = FontFamily(
    Font(R.font.google_sans_code_regular, FontWeight.Normal),
    Font(R.font.google_sans_code_medium, FontWeight.Medium),
)

/**
 * The sans role. `FontFamily.Default` resolves to the platform product font, which on the
 * devices this app is built for is Roboto — or Google Sans where the OEM ships it. Asking for
 * the platform font rather than bundling one is what makes the app look native on the phone
 * it is running on, which is the whole point of matching the house style.
 */
private val Sans = FontFamily.Default

@Immutable
data class WarrantColors(
    val ground: Ground,
    /** The page behind everything. */
    val bg: Color,
    /** One step up from [bg] — cards, inputs, capture tiles, anything inset. */
    val surface: Color,
    /** Two steps up. Menus, a raised card, a selected row. */
    val surfaceHigh: Color,
    /** Three steps up. Rare. */
    val surfaceHighest: Color,
    /** Body text on [bg]. */
    val fg: Color,
    /** Secondary text — supporting copy, meta, anything the eye reaches second. */
    val fg2: Color,
    /** Tertiary text — timestamps, counts, hints. */
    val fg3: Color,
    /** Hairlines and the outlines of outlined components. */
    val hairline: Color,
    /** The action colour. Google Blue, on whichever ground this is. */
    val action: Color,
    /** Text and icons drawn on top of [action]. */
    val onAction: Color,
    val measured: Color,
    val specified: Color,
    val inferred: Color,
    val asserted: Color,
    val open: Color,
    val waiting: Color,
    val held: Color,
    val sealed: Color,
) {
    /**
     * The classes come from the contract, not from a parallel enum declared here. A second
     * copy would be free to drift from `contract/entities`, and ContractShapeTest would never
     * see it.
     */
    fun of(c: ProvenanceClass): Color = when (c) {
        ProvenanceClass.MEASURED -> measured
        ProvenanceClass.SPECIFIED -> specified
        ProvenanceClass.INFERRED -> inferred
        ProvenanceClass.ASSERTED -> asserted
    }

    fun of(s: JobStatus): Color = when (s) {
        // A draft is not yet work. It reads as waiting rather than open, because no agent has
        // looked at it and nothing about it is settled.
        JobStatus.DRAFT -> waiting
        JobStatus.OPEN -> open
        JobStatus.WAITING -> waiting
        JobStatus.HELD -> held
        JobStatus.SEALED -> sealed
    }

    /**
     * A Material tonal container: the hue laid over the ground at container strength. Every
     * filled-tonal surface in the app is built with this rather than a second hand-picked
     * colour, so a class's container and its chip can never disagree.
     */
    fun container(c: Color, strength: Float = 0.16f): Color = c.copy(alpha = strength).compositeOver(bg)
}

private fun Color.compositeOver(background: Color): Color {
    val a = alpha
    return Color(
        red = red * a + background.red * (1 - a),
        green = green * a + background.green * (1 - a),
        blue = blue * a + background.blue * (1 - a),
        alpha = 1f,
    )
}

/**
 * The `-lift` variants exist because the same hue that reads correctly on paper disappears
 * against the workshop ground. Picking the wrong one is the single most common way the two
 * stacks drift apart, so neither stack picks by hand — both ask the ground.
 */
private val WorkColors = WarrantColors(
    ground = Ground.Work,
    bg = Tokens.work,
    surface = Tokens.work2,
    surfaceHigh = Tokens.work3,
    surfaceHighest = Tokens.work4,
    fg = Tokens.fg,
    fg2 = Tokens.fg2,
    fg3 = Tokens.fg3,
    hairline = Tokens.ruleDark,
    action = Tokens.primaryLift,
    onAction = Color(0xFF062E6F),
    measured = Tokens.measuredLift,
    specified = Tokens.specifiedLift,
    inferred = Tokens.inferredLift,
    asserted = Tokens.assertedLift,
    open = Tokens.openLift,
    waiting = Tokens.inferredLift,
    held = Tokens.heldLift,
    sealed = Tokens.measuredLift,
)

private val PaperColors = WarrantColors(
    ground = Ground.Paper,
    bg = Tokens.rec,
    surface = Tokens.rec2,
    surfaceHigh = Tokens.rec3,
    surfaceHighest = Tokens.rec3,
    fg = Tokens.ink,
    fg2 = Tokens.ink2,
    fg3 = Tokens.ink3,
    hairline = Tokens.rule,
    action = Tokens.primary,
    onAction = Color.White,
    measured = Tokens.measured,
    specified = Tokens.specified,
    inferred = Tokens.inferred,
    asserted = Tokens.asserted,
    open = Tokens.open,
    waiting = Tokens.inferred,
    held = Tokens.held,
    sealed = Tokens.measured,
)

/**
 * Type, on the Material 3 scale.
 *
 * Sentence case throughout, including on controls — Material 3 dropped the shouted uppercase
 * button label, and nothing says "not a Google app" faster than a wall of tracked-out caps.
 *
 * THE ONE RULE THAT IS NOT COSMETIC, carried over verbatim from `web/src/components/library.css`:
 *
 *   mono + tabular numerals = the value came from a machine
 *                             (measured, specified, timestamps, tool ids, part numbers, money)
 *   sans                    = the value came from a person
 *                             (assertions, signatures, reasons, explanations, anything typed or spoken)
 *
 * The mono face is Google Sans Code, so the rule costs the house style nothing.
 * Provenance is legible in the typeface before you reach the colour chip. Do not mix them.
 */
@Immutable
data class WarrantType(
    /** Machine. The small print — chips, meta, column heads. M3 label-small/medium. */
    val monoLabel: TextStyle = TextStyle(
        fontFamily = GoogleSansCode,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
        fontWeight = FontWeight.Medium,
    ),
    /** Machine. Readable — timestamps, tool ids, meta rows. */
    val mono: TextStyle = TextStyle(
        fontFamily = GoogleSansCode,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        letterSpacing = 0.sp,
    ),
    /** Machine, and loud. The number on a ReadingBadge. M3 title-large, in the mono face. */
    val monoValue: TextStyle = TextStyle(
        fontFamily = GoogleSansCode,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = 0.sp,
        fontWeight = FontWeight.Medium,
    ),
    /** Person. M3 body-large — the default for prose a technician reads while working. */
    val body: TextStyle = TextStyle(
        fontFamily = Sans,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.5.sp,
    ),
    /** Person. M3 body-medium — guidance, rationale, reasons. */
    val bodySmall: TextStyle = TextStyle(
        fontFamily = Sans,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.25.sp,
    ),
    /** Every control on every surface. M3 label-large. Sentence case, always. */
    val label: TextStyle = TextStyle(
        fontFamily = Sans,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
        fontWeight = FontWeight.Medium,
    ),
    /** M3 title-medium. A row headline, a card name. */
    val titleSmall: TextStyle = TextStyle(
        fontFamily = Sans,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.15.sp,
        fontWeight = FontWeight.Medium,
    ),
    /** M3 title-large. The top app bar, and a step title. */
    val title: TextStyle = TextStyle(
        fontFamily = Sans,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = 0.sp,
        fontWeight = FontWeight.Normal,
    ),
    /** M3 headline-medium. The largest thing on a screen. Regular weight — Material headlines
     *  are not bold; the size is what carries them. */
    val heading: TextStyle = TextStyle(
        fontFamily = Sans,
        fontSize = 28.sp,
        lineHeight = 36.sp,
        letterSpacing = 0.sp,
        fontWeight = FontWeight.Normal,
    ),
    /** A person's name, signed. Italic, never mono — no machine produced it. */
    val signature: TextStyle = TextStyle(
        fontFamily = Sans,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = 0.sp,
        fontStyle = FontStyle.Italic,
    ),
)

@Immutable
data class WarrantDim(
    /** Screen edge padding. Material's standard 16dp gutter. */
    val pad: Dp = 16.dp,
    /** Vertical rhythm between elements of one card. */
    val stack: Dp = 16.dp,
    /**
     * Touch targets never go below this, on any surface. Dirty hands, small screen — the
     * comment in the web stylesheet, and it matters more here than it does there.
     */
    val tap: Dp = 48.dp,
    val hairline: Dp = 1.dp,
    /** The Material 3 shape scale, straight from the generated tokens. */
    val rXs: Dp = Tokens.Shape.rXs,
    val rSm: Dp = Tokens.Shape.rSm,
    val rMd: Dp = Tokens.Shape.rMd,
    val rLg: Dp = Tokens.Shape.rLg,
    val rXl: Dp = Tokens.Shape.rXl,
    /** The default corner. Anything that does not have an opinion gets this one. */
    val radius: Dp = Tokens.Shape.radius,
)

private val LocalWarrantColors = staticCompositionLocalOf { WorkColors }
private val LocalWarrantType = staticCompositionLocalOf { WarrantType() }
private val LocalWarrantDim = staticCompositionLocalOf { WarrantDim() }

object WarrantTheme {
    val colors: WarrantColors
        @Composable @ReadOnlyComposable get() = LocalWarrantColors.current
    val type: WarrantType
        @Composable @ReadOnlyComposable get() = LocalWarrantType.current
    val dim: WarrantDim
        @Composable @ReadOnlyComposable get() = LocalWarrantDim.current

    /** A fully rounded control. The Material pill, and the loudest single signal that a
     *  button belongs to a Google product. */
    val pill = RoundedCornerShape(percent = 50)
}

/** The M3 shape scale, so any stock Material component picks up the house corners. */
private val WarrantShapes = Shapes(
    extraSmall = RoundedCornerShape(Tokens.Shape.rXs),
    small = RoundedCornerShape(Tokens.Shape.rSm),
    medium = RoundedCornerShape(Tokens.Shape.rMd),
    large = RoundedCornerShape(Tokens.Shape.rLg),
    extraLarge = RoundedCornerShape(Tokens.Shape.rXl),
)

private fun typographyOf(t: WarrantType) = Typography(
    headlineMedium = t.heading,
    titleLarge = t.title,
    titleMedium = t.titleSmall,
    bodyLarge = t.body,
    bodyMedium = t.bodySmall,
    labelLarge = t.label,
    labelMedium = t.monoLabel,
)

/**
 * Wraps the app. [ground] is explicit rather than derived from the system setting, because
 * which ground a screen uses is a meaning — workshop or record — not a user preference.
 */
@Composable
fun WarrantTheme(
    ground: Ground = Ground.Work,
    content: @Composable () -> Unit,
) {
    val colors = if (ground == Ground.Work) WorkColors else PaperColors
    val type = WarrantType()

    // A complete Material 3 scheme, not a stub. Stock components — ripples, text fields,
    // menus, snackbars, selection handles — all read from here, so anything dropped onto a
    // screen without a bespoke wrapper still lands on the house palette.
    val scheme = if (ground == Ground.Work) {
        darkColorScheme(
            primary = colors.action,
            onPrimary = colors.onAction,
            primaryContainer = colors.container(colors.action, 0.24f),
            onPrimaryContainer = colors.action,
            secondary = colors.fg2,
            onSecondary = colors.bg,
            tertiary = colors.measured,
            onTertiary = colors.bg,
            background = colors.bg,
            onBackground = colors.fg,
            surface = colors.bg,
            onSurface = colors.fg,
            surfaceVariant = colors.surface,
            onSurfaceVariant = colors.fg2,
            surfaceContainerLowest = colors.bg,
            surfaceContainerLow = colors.surface,
            surfaceContainer = colors.surface,
            surfaceContainerHigh = colors.surfaceHigh,
            surfaceContainerHighest = colors.surfaceHighest,
            outline = colors.hairline,
            outlineVariant = colors.hairline,
            error = colors.held,
            onError = colors.bg,
            errorContainer = colors.container(colors.held),
            onErrorContainer = colors.held,
        )
    } else {
        lightColorScheme(
            primary = colors.action,
            onPrimary = colors.onAction,
            primaryContainer = Tokens.primaryWash,
            onPrimaryContainer = Tokens.primarySunk,
            secondary = colors.fg2,
            onSecondary = Color.White,
            tertiary = colors.measured,
            onTertiary = Color.White,
            background = colors.bg,
            onBackground = colors.fg,
            surface = colors.bg,
            onSurface = colors.fg,
            surfaceVariant = colors.surface,
            onSurfaceVariant = colors.fg2,
            surfaceContainerLowest = colors.bg,
            surfaceContainerLow = colors.surface,
            surfaceContainer = colors.surface,
            surfaceContainerHigh = colors.surfaceHigh,
            surfaceContainerHighest = colors.surfaceHighest,
            outline = colors.hairline,
            outlineVariant = colors.hairline,
            error = colors.held,
            onError = Color.White,
            errorContainer = colors.container(colors.held, 0.12f),
            onErrorContainer = colors.held,
        )
    }

    CompositionLocalProvider(
        LocalWarrantColors provides colors,
        LocalWarrantType provides type,
        LocalWarrantDim provides WarrantDim(),
        LocalTextStyle provides type.body.copy(color = colors.fg),
    ) {
        MaterialTheme(
            colorScheme = scheme,
            typography = typographyOf(type),
            shapes = WarrantShapes,
            content = content,
        )
    }
}

/**
 * A screen's ground. Fills, sets the text colour, and re-provides the palette so anything
 * nested reads the right `-lift` variants without being told.
 */
@Composable
fun Ground(
    ground: Ground,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val colors = if (ground == Ground.Work) WorkColors else PaperColors
    CompositionLocalProvider(
        LocalWarrantColors provides colors,
        LocalTextStyle provides LocalTextStyle.current.copy(color = colors.fg),
    ) {
        Box(modifier.fillMaxSize().background(colors.bg), content = content)
    }
}
