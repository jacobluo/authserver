import { useState, useEffect, useCallback } from "react";
import { C, fonts, sz, alpha } from "../tokens";
import { getStats, getSystemStatus, getSystemConfig, queryAudit } from "../api";
import type { StatsResponse, SystemStatusResponse, SystemConfigResponse, AuditEvent } from "../api";
import Card from "../components/Card";
import Label from "../components/Label";
import SectionTitle from "../components/SectionTitle";
import StatusDot from "../components/StatusDot";
import Tag from "../components/Tag";
import Mono from "../components/Mono";
import Table from "../components/Table";
import InfoBox from "../components/InfoBox";
import { useTranslation } from "../i18n";

// Event color mapping for audit events
function eventColor(event: string): string {
  if (event.includes("agent.") || event.includes("token.exchanged")) return C.purple;
  if (event.includes("vended") || event.includes("token_issued")) return C.success;
  if (event.includes("created")) return C.blue;
  if (event.includes("rotated") || event.includes("updated")) return C.accent;
  if (event.includes("deleted") || event.includes("suspended") || event.includes("revoked") || event.includes("rejected")) return C.danger;
  if (event.includes("dpop.")) return C.warn;
  return C.textDim;
}

function formatRelativeTime(isoDate: string, t: ReturnType<typeof useTranslation>["t"]): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("justNow");
  if (mins < 60) return t("minutesAgo", { minutes: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("hoursAgo", { hours: hrs });
  const days = Math.floor(hrs / 24);
  return t("daysAgo", { days });
}

export default function Overview() {
  const { t } = useTranslation("overview");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [config, setConfig] = useState<SystemConfigResponse | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [s, st, cfg, a] = await Promise.all([
        getStats(),
        getSystemStatus(),
        getSystemConfig(),
        queryAudit({ limit: 7 }),
      ]);
      setStats(s);
      setStatus(st);
      setConfig(cfg);
      setAudit(a);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 30000);
    return () => clearInterval(iv);
  }, [loadData]);

  return (
    <div style={{ padding: 28 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: sz.xl, fontWeight: 600, marginBottom: 4 }}>
        {t("title")}
      </div>
      <div style={{ fontSize: sz.base, color: C.textDim, marginBottom: 24 }}>
        {status ? t("statusSummary", { version: status.version, uptime: status.uptime }) : t("loading")}
      </div>

      {error && (
        <InfoBox color={C.danger}>
          <strong style={{ color: C.danger }}>{t("errorLabel")}</strong> {error}
        </InfoBox>
      )}

      {/* Status cards —  dropped the legacy "Connectors" + "Vault
          Connections" cards. The replacement narrows the row to 3 cells:
          Signing Key + Encryption + Token Exchange. The Vault Connections
          stat has no replacement; if operators ask for a "Broker Grants"
          stat, file as a follow-up admin-stats extension PR. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
        <Card>
          <Label>{t("signingKey")}</Label>
          <div style={{ fontFamily: fonts.mono, fontSize: sz.xl, color: C.accent, marginBottom: 4 }}>
            {config?.signing.algorithm || "—"}
          </div>
          <div style={{ fontSize: sz.base, color: C.textDim }}>
            {config?.signing.key_store || "—"}
          </div>
        </Card>
        <Card>
          <Label>{t("encryption")}</Label>
          <div style={{ fontFamily: fonts.mono, fontSize: sz.base, color: C.text, marginBottom: 4 }}>
            {config?.encryption.driver || "—"}
          </div>
          <div style={{ fontSize: sz.base }}>
            <StatusDot status={status?.subsystems.find(s => s.name === "encryption")?.status || "unknown"} />
            {t(status?.subsystems.find(s => s.name === "encryption")?.status || "unknown")}
          </div>
        </Card>
        <Card>
          <Label>{t("tokenExchange")}</Label>
          <div style={{ fontFamily: fonts.mono, fontSize: sz.xl, color: C.text, marginBottom: 4 }}>
            {config?.token_exchange.enabled ? t("enabled") : t("disabled")}
          </div>
          <div style={{ fontSize: sz.base, color: C.textDim }}>
            {config?.token_exchange.enabled
              ? t("maxChainDepth", { depth: config.token_exchange.max_chain_depth })
              : t("configureTokenExchange")}
          </div>
        </Card>
      </div>

      {/* Quick stats */}
      {stats && (
        <div style={{
          display: "flex", gap: 32, marginBottom: 20, padding: "14px 20px",
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, flexWrap: "wrap",
        }}>
          {[
            [t("clients"), stats.clients],
            [t("users"), stats.users],
            [t("tokens24h"), stats.active_tokens_24h],
            [t("revoked"), stats.revoked_tokens],
          ].map(([label, value]) => (
            <div key={label as string}>
              <div style={{ fontFamily: fonts.mono, fontSize: sz.xs, color: C.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>
                {label}
              </div>
              <div style={{ fontFamily: fonts.mono, fontSize: sz.xxl, color: C.text }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alerts from system config */}
      {config && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {config.dpop.enabled && (
            <div style={{ background: alpha(C.blue, 0x10), border: `1px solid ${alpha(C.blue, 0x30)}`, borderRadius: 6, padding: "10px 16px", fontSize: sz.base, color: C.textDim }}>
              <span style={{ color: C.blue, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1, marginRight: 8 }}>
                {t("info")}
              </span>
              {t("dpopEnabled", { ttl: config.dpop.nonce_ttl || t("default") })}
              {config.agents.enabled && t("agentsEnabled")}
            </div>
          )}
          {config.token_exchange.enabled && (
            <div style={{ background: alpha(C.purple, 0x10), border: `1px solid ${alpha(C.purple, 0x30)}`, borderRadius: 6, padding: "10px 16px", fontSize: sz.base, color: C.textDim }}>
              <span style={{ color: C.purple, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1, marginRight: 8 }}>
                {t("info")}
              </span>
              {t("tokenExchangeEnabled", { depth: config.token_exchange.max_chain_depth })}
            </div>
          )}
        </div>
      )}

      {/* Recent audit events */}
      <Card>
        <SectionTitle>{t("recentAuditEvents")}</SectionTitle>
        {audit.length === 0 ? (
          <div style={{ fontSize: sz.base, color: C.textDim, padding: "12px 0" }}>{t("noRecentEvents")}</div>
        ) : (
          <Table
            headers={[t("time"), t("event"), t("actor"), t("detail")]}
            rows={audit.map((e) => [
              <Mono>{formatRelativeTime(e.created_at, t)}</Mono>,
              <Tag color={eventColor(e.action)}>{e.action}</Tag>,
              <Mono>{e.actor_id || "—"}</Mono>,
              <span style={{ fontSize: sz.base, color: C.textDim }}>{e.detail || "—"}</span>,
            ])}
          />
        )}
      </Card>
    </div>
  );
}
