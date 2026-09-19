import { useState, useEffect, useCallback } from "react";
import { C, fonts, sz, alpha } from "../../tokens";
import { listTokens, revokeToken } from "../../api";
import type { TokenView } from "../../api";
import Card from "../../components/Card";
import Btn from "../../components/Btn";
import Tag from "../../components/Tag";
import Mono from "../../components/Mono";
import StatusDot from "../../components/StatusDot";
import TextInput from "../../components/TextInput";
import Drawer from "../../components/Drawer";
import DrawerRow from "../../components/DrawerRow";
import SectionTitle from "../../components/SectionTitle";
import Toast from "../../components/Toast";
import { useTranslation } from "../../i18n";

function truncate(id: string): string {
  return id.length > 12 ? id.substring(0, 12) + "\u2026" : id;
}

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string | undefined, locale: string): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleString(locale, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function typeLabel(t: string): string {
  switch (t) {
    case "authorization_code": return "auth_code";
    case "client_credentials": return "client_creds";
    default: return t;
  }
}

function typeColor(t: string): string {
  switch (t) {
    case "authorization_code": return C.blue;
    case "client_credentials": return C.purple;
    default: return C.textDim;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case "active": return "active";
    case "revoked": return "suspended";
    case "expired": return "disabled";
    default: return s;
  }
}

export default function IssuedTab() {
  const { t: tr, i18n } = useTranslation("tokens");
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState<TokenView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadTokens = useCallback(async () => {
    try {
      const data = await listTokens({ limit: 200 });
      setTokens(data.tokens || []);
      setTotal(data.total || 0);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("loadFailed"));
    }
  }, [tr]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const filtered = tokens.filter((t) => {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        t.jti.toLowerCase().includes(s) ||
        t.client_id.toLowerCase().includes(s) ||
        (t.user_id || "").toLowerCase().includes(s) ||
        (t.scope || "").toLowerCase().includes(s)
      );
    }
    return true;
  });

  const handleRevoke = async (jti: string) => {
    setRevoking(true);
    try {
      await revokeToken(jti);
      showToast(tr("revokedToast"));
      setSelected(null);
      loadTokens();
    } catch (err) {
      showToast(err instanceof Error ? err.message : tr("revokeFailed"));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: sz.base, color: C.textDim, marginBottom: 14 }}>
        {tr("issuedCount", { count: total })}
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: "8px 14px", background: alpha(C.danger, 0x12), border: `1px solid ${alpha(C.danger, 0x40)}`, borderRadius: 6, fontSize: sz.base, color: C.danger }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <TextInput placeholder={tr("searchPlaceholder")} value={search} onChange={setSearch} style={{ width: 300 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {["all", "authorization_code", "client_credentials"].map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={{
                padding: "5px 12px",
                borderRadius: 5,
                border: `1px solid ${typeFilter === t ? alpha(C.accent, 0x50) : C.border2}`,
                background: typeFilter === t ? alpha(C.accent, 0x18) : "transparent",
                color: typeFilter === t ? C.accent : C.textDim,
                cursor: "pointer",
                fontFamily: fonts.mono,
                fontSize: sz.sm,
                transition: "all 0.15s",
              }}
            >
              {t === "all" ? tr("all") : tr(`typeValue.${t}`, { defaultValue: typeLabel(t) })}
            </button>
          ))}
        </div>
      </div>

      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: sz.base }}>
          <thead>
            <tr>
              {["JTI", tr("type"), tr("client"), tr("user"), tr("scope"), tr("status"), tr("created")].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: C.textDim, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1.2, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>
                  {h}
                </th>
              ))}
              <th style={{ textAlign: "right", padding: "8px 12px", color: C.textDim, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1.2, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>
                {tr("action")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr
                key={t.jti}
                onClick={() => setSelected(t)}
                style={{ cursor: "pointer", borderBottom: `1px solid ${C.border}`, transition: "background 0.1s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <td style={{ padding: "10px 12px" }}><Mono>{truncate(t.jti)}</Mono></td>
                <td style={{ padding: "10px 12px" }}><Tag color={typeColor(t.type)}>{tr(`typeValue.${t.type}`, { defaultValue: typeLabel(t.type) })}</Tag></td>
                <td style={{ padding: "10px 12px" }}><Mono style={{ fontSize: sz.sm }}>{truncate(t.client_id)}</Mono></td>
                <td style={{ padding: "10px 12px" }}>
                  {t.user_id
                    ? <Mono style={{ fontSize: sz.sm }}>{truncate(t.user_id)}</Mono>
                    : <span style={{ color: C.textDim }}>{"\u2014"}</span>
                  }
                </td>
                <td style={{ padding: "10px 12px" }}>
                  {t.scope
                    ? <Mono style={{ fontSize: sz.sm }}>{t.scope.length > 30 ? t.scope.substring(0, 30) + "\u2026" : t.scope}</Mono>
                    : <span style={{ color: C.textDim }}>{"\u2014"}</span>
                  }
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <StatusDot status={statusColor(t.status)} />
                  <span style={{ fontSize: sz.base, color: C.textDim }}>{tr(`statusValue.${t.status}`, { defaultValue: t.status })}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ fontSize: sz.base, color: C.textDim }}>{formatDate(t.created_at, i18n.language)}</span>
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>
                  {t.status === "active" && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Btn danger small onClick={() => handleRevoke(t.jti)}>{tr("revoke")}</Btn>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: "20px 12px", fontSize: sz.base, color: C.textDim, textAlign: "center" }}>
            {tokens.length === 0 ? tr("empty") : tr("noMatches")}
          </div>
        )}
      </Card>

      {/* Token Detail Drawer */}
      {selected && (
        <Drawer title={tr("detailTitle")} subtitle={truncate(selected.jti)} onClose={() => setSelected(null)}>
          <DrawerRow label="jti" value={<Mono style={{ fontSize: sz.sm }}>{selected.jti}</Mono>} />
          <DrawerRow label={tr("type")} value={<Tag color={typeColor(selected.type)}>{tr(`typeValue.${selected.type}`, { defaultValue: typeLabel(selected.type) })}</Tag>} />
          <DrawerRow label="client_id" value={<Mono style={{ fontSize: sz.sm }}>{selected.client_id}</Mono>} />
          <DrawerRow label="user_id" value={
            selected.user_id
              ? <Mono style={{ fontSize: sz.sm }}>{selected.user_id}</Mono>
              : <span style={{ color: C.textDim }}>{"\u2014"}</span>
          } />
          <DrawerRow label={tr("scope")} value={
            selected.scope
              ? <Mono style={{ fontSize: sz.sm }}>{selected.scope}</Mono>
              : <span style={{ color: C.textDim }}>{"\u2014"}</span>
          } />
          <DrawerRow label={tr("resource")} value={
            selected.resource
              ? <Mono style={{ fontSize: sz.sm }}>{selected.resource}</Mono>
              : <span style={{ color: C.textDim }}>{"\u2014"}</span>
          } />
          <DrawerRow label={tr("status")} value={<><StatusDot status={statusColor(selected.status)} />{tr(`statusValue.${selected.status}`, { defaultValue: selected.status })}</>} />
          <DrawerRow label={tr("createdAt")} value={formatDateTime(selected.created_at, i18n.language)} />
          <DrawerRow label={tr("expiresAt")} value={formatDateTime(selected.expires_at, i18n.language)} />

          <div style={{ marginTop: 20 }}>
            <SectionTitle>{tr("actions")}</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selected.status === "active" ? (
                <Btn danger small full onClick={() => handleRevoke(selected.jti)} disabled={revoking}>
                  {revoking ? tr("revoking") : tr("revokeToken")}
                </Btn>
              ) : (
                <div style={{ fontSize: sz.sm, color: C.textDim, fontStyle: "italic" }}>
                  {tr("alreadyStatus", { status: tr(`statusValue.${selected.status}`, { defaultValue: selected.status }) })}
                </div>
              )}
            </div>
          </div>
        </Drawer>
      )}

      <Toast message={toast} />
    </div>
  );
}
