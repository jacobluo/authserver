import { useState } from "react";
import { C, fonts, sz } from "../tokens";
import IssuedTab from "./tokens/IssuedTab";
import InspectorTab from "./tokens/InspectorTab";
import { useTranslation } from "../i18n";

const tabs = [
  { id: "issued", label: "issuedTab" },
  { id: "inspector", label: "inspectorTab" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function Tokens() {
  const { t } = useTranslation("tokens");
  const [tab, setTab] = useState<TabId>("issued");

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: sz.xl, fontWeight: 600, fontFamily: fonts.mono }}>{t("title")}</div>
        <div style={{ fontSize: sz.base, color: C.textDim, marginTop: 2 }}>
          {t("subtitle")}
        </div>
      </div>

      <div style={{ display: "flex", gap: 2, marginBottom: 24, borderBottom: `1px solid ${C.border}` }}>
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            onClick={() => setTab(tabItem.id)}
            style={{
              padding: "8px 18px",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${tab === tabItem.id ? C.accent : "transparent"}`,
              color: tab === tabItem.id ? C.accent : C.textDim,
              cursor: "pointer",
              fontFamily: fonts.mono,
              fontSize: sz.base,
              marginBottom: -1,
              transition: "all 0.15s",
            }}
          >
            {t(tabItem.label)}
          </button>
        ))}
      </div>

      {tab === "issued" && <IssuedTab />}
      {tab === "inspector" && <InspectorTab />}
    </div>
  );
}
