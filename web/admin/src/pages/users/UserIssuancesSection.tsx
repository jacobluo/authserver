// UserIssuancesSection.tsx — Recent Issuances panel for the Users detail Drawer.
//
// closes the Users → Issuances half of the cross-link surface.
// Renders the user's 10 most recent Mint / Broker issuances and links
// to the full /admin/issuances list pre-filtered to this user.

import { useState, useEffect, useCallback } from "react";
import { C, fonts, sz } from "../../tokens";
import { listIssuancesForUser, listClients, listResources } from "../../api";
import type {
  UserView, ClientView, ResourceView, IssuanceView, BackendKind,
} from "../../api";
import Mono from "../../components/Mono";
import Tag from "../../components/Tag";
import SectionTitle from "../../components/SectionTitle";
import { useTranslation } from "../../i18n";

interface Props {
  user: UserView;
}

const RECENT_LIMIT = 10;

function truncate(s: string, n = 14): string {
  return s.length > n ? s.substring(0, n) + "…" : s;
}

function formatDateTime(iso: string | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function backendColor(k: BackendKind): string {
  return k === "mint" ? C.blue : C.purple;
}

function statusOf(i: IssuanceView): "active" | "revoked" | "expired" {
  if (i.revoked_at) return "revoked";
  if (i.expires_at && new Date(i.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

function statusColor(s: "active" | "revoked" | "expired"): string {
  if (s === "active") return C.success;
  if (s === "revoked") return C.danger;
  return C.textDim;
}

export default function UserIssuancesSection({ user }: Props) {
  const { t, i18n } = useTranslation("users");
  const [rows, setRows] = useState<IssuanceView[]>([]);
  const [clients, setClients] = useState<ClientView[]>([]);
  const [resources, setResources] = useState<ResourceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const [res, cs, rs] = await Promise.all([
        listIssuancesForUser(user.id, { since, limit: RECENT_LIMIT }),
        listClients(),
        listResources(),
      ]);
      setRows(res.issuances.slice(0, RECENT_LIMIT));
      setClients(cs);
      setResources(rs);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadIssuancesFailed"));
    } finally {
      setLoading(false);
    }
  }, [user.id, t]);

  useEffect(() => { load(); }, [load]);

  const clientLabel = (id: string): string => {
    const c = clients.find((cc) => cc.id === id);
    return c ? c.name : id;
  };
  const resourceLabel = (id: string): string => {
    const r = resources.find((rr) => rr.id === id);
    return r ? r.slug : id;
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <SectionTitle>{t("recentIssuances")}</SectionTitle>
        <a
          href={`#/issuances?user=${encodeURIComponent(user.id)}`}
          style={{ fontSize: sz.sm, color: C.accent, textDecoration: "none", fontFamily: fonts.mono }}
          title={t("viewAllTitle")}
        >
          {t("viewAll")}
        </a>
      </div>

      {loading && (
        <div style={{ fontSize: sz.base, color: C.textDim, padding: "8px 0" }}>{t("loading")}</div>
      )}

      {error && (
        <div style={{ fontSize: sz.base, color: C.danger, padding: "8px 0" }}>{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div style={{ fontSize: sz.base, color: C.textDim, padding: "8px 0" }}>
          {t("noRecentIssuances")}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: sz.base }}>
          <thead>
            <tr>
              {[t("jti"), t("client"), t("resource"), t("backend"), t("issued"), t("status")].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.textDim, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1.2, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const s = statusOf(i);
              return (
                <tr key={i.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "6px 8px" }}>
                    <Mono style={{ fontSize: sz.sm }}>{i.jti ? truncate(i.jti, 12) : "—"}</Mono>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Mono style={{ fontSize: sz.sm }}>{clientLabel(i.client_id)}</Mono>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Mono style={{ fontSize: sz.sm }}>{resourceLabel(i.resource_id)}</Mono>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Tag color={backendColor(i.backend_kind)}>{t(`backendValue.${i.backend_kind}`, { defaultValue: i.backend_kind })}</Tag>
                  </td>
                  <td style={{ padding: "6px 8px", color: C.textDim, fontSize: sz.sm }}>
                    {formatDateTime(i.issued_at, i18n.language)}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Tag color={statusColor(s)}>{t(`statusValue.${s}`)}</Tag>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
