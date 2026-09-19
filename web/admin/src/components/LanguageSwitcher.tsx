import { useTranslation, setLanguage } from "../i18n";
import { C, fonts, sz } from "../tokens";

interface LanguageSwitcherProps {
  compact?: boolean;
}

export default function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation("common");
  const next = i18n.language === "en" ? "zh-CN" : "en";
  const nextLabel = next === "en" ? t("english") : t("chinese");

  return (
    <button
      type="button"
      title={`${t("language")}: ${nextLabel}`}
      aria-label={`${t("language")}: ${nextLabel}`}
      onClick={() => void setLanguage(next)}
      style={{
        width: compact ? "100%" : "auto",
        padding: compact ? "7px 8px" : "6px 10px",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        color: C.textDim,
        background: C.surface,
        cursor: "pointer",
        fontFamily: fonts.sans,
        fontSize: sz.sm,
        whiteSpace: "nowrap",
      }}
    >
      {compact ? (next === "en" ? "EN" : "中") : nextLabel}
    </button>
  );
}
