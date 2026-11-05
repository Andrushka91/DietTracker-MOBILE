/** Editable authority. JS sibling is generated, not independently edited. dp/sp. */
export const controls = {
  /** Width assumed for a label before its real text has been measured. */
  unmeasuredLabelWidth: 24,
  visibleHeight: 30,
  radius: 8,
  border: 1,
  targetAndroid: 48,
  targetIOS: 44,
  paddingX: 5,
  paddingY: 4,
  gap: 8,
  fontSize: 12,
  lineHeight: 18,
  font: "OpenSans_400Regular",
  statusMinWidth: 100,
  /** Width assumed for "HH:MM" before the displayed value has been measured. */
  timeTextFallbackWidth: 36,
  timeHeight: 30,
  timePaddingX: 5,
  timeIcon: 12,
  timeGap: 2,
  gutter: 8,
  cardGap: 8,
  disabledOpacity: 0.5,
} as const;

/** Reference fixtures only. Production consumes themeColors and accentActions.ts. */
export const palettes = {
  light: {
    dark: false,
    accent: "#4655D6",
    background: "#F4F6F8",
    cardFill: "#FFFFFF",
    surfaceVariant: "#E9EEF5",
    text: "#101828",
    textSecondary: "#3F4A5A",
    textMuted: "#667085",
    border: "#DCE3EC",
    hairline: "#E4E7EC",
    cancel: "#A52F40",
    cancelBorder: "#D7A0A8",
    cancelFill: "#FFF7F8",
    cancelPressed: "#FFF0F2",
  },
  dark: {
    dark: true,
    accent: "#8B95F6",
    background: "#0B0F14",
    cardFill: "#151B23",
    surfaceVariant: "#1F2833",
    text: "#F5F7FA",
    textSecondary: "#C6D0DC",
    textMuted: "#9AA8BA",
    border: "#2A3542",
    hairline: "#222B36",
    cancel: "#FFACB7",
    cancelBorder: "#A36270",
    cancelFill: "#2C2028",
    cancelPressed: "#39202B",
  },
} as const;

export type ReferencePalette = (typeof palettes)[keyof typeof palettes];

export function referenceInk(
  p: ReferencePalette,
  kind: "save" | "cancel",
  pressed = false
) {
  if (kind === "cancel") {
    return {
      foreground: p.cancel,
      border: p.cancelBorder,
      fill: pressed ? p.cancelPressed : p.cancelFill,
    };
  }
  const alpha = p.dark ? (pressed ? "32" : "2E") : pressed ? "2E" : "1A";
  return {
    foreground: p.accent,
    border: p.accent,
    fill: `${p.accent}${alpha}`,
  };
}
