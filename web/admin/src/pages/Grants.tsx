// Grants.tsx — admin surface for the unified user-grants view.
//
// Two grant kinds for one user:
//   - ConsentGrant: agent X may exchange a subject token from user U for
//     Mint resource R with a given scope set. Revoking cascades to live
//     Mint issuances.
//   - BrokerGrant: user U has an upstream credential at provider P with a
//     given scope set. Revoking blocks future broker exchanges; already
//     vended upstream tokens stay live until expiry — Authplane cannot
//     invalidate them at the upstream.
//
// The page wraps the same user-grants tables that UserGrantsSection
// renders inline on the Users detail Drawer. Rendering is exported so
// the two surfaces stay in sync.

import { useState, useEffect, useCallback } from "react";
import { C, fonts, sz, alpha } from "../tokens";
import {
  listUsers, listClients, listResources, listBrokerProviders,
  listUserGrants, revokeConsentGrant, revokeBrokerGrant,
} from "../api";
import type {
  UserView, ClientView, ResourceView, BrokerProviderView, UserGrantsView,
  ConsentGrantView, BrokerGrantView,
} from "../api";
import Btn from "../components/Btn";
import Card from "../components/Card";
import Mono from "../components/Mono";
import Tag from "../components/Tag";
import TextInput from "../components/TextInput";
import Modal from "../components/Modal";
import Toast from "../components/Toast";
import SectionTitle from "../components/SectionTitle";
import { i18n, useTranslation } from "../i18n";

interface RevokeTarget {
  kind: "consent" | "broker";
  id: string;
  description: string;
}

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(locale, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Grants() {
  const { t } = useTranslation("grants");
  const [users, setUsers] = useState<UserView[]>([]);
  const [clients, setClients] = useState<ClientView[]>([]);
  const [resources, setResources] = useState<ResourceView[]>([]);
  const [providers, setProviders] = useState<BrokerProviderView[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserView | null>(null);
  const [grants, setGrants] = useState<UserGrantsView | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const [loadingGrants, setLoadingGrants] = useState(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadDirectory = useCallback(async () => {
    try {
      const [us, cs, rs, ps] = await Promise.all([
        listUsers(),
        listClients(),
        listResources(),
        listBrokerProviders(),
      ]);
      setUsers(us);
      setClients(cs);
      setResources(rs);
      setProviders(ps);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("directoryLoadFailed"));
    }
  }, [t]);

  const loadGrants = useCallback(async (userID: string) => {
    setLoadingGrants(true);
    try {
      const g = await listUserGrants(userID);
      setGrants(g);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("grantsLoadFailed"), "error");
      setGrants(null);
    } finally {
      setLoadingGrants(false);
    }
  }, [t]);

  useEffect(() => { loadDirectory(); }, [loadDirectory]);

  const filteredUsers = users.filter((u) => {
    if (!userQuery) return true;
    const t = userQuery.toLowerCase();
    return (
      u.email.toLowerCase().includes(t) ||
      u.name.toLowerCase().includes(t) ||
      u.id.toLowerCase().includes(t)
    );
  });

  const handleSelectUser = (u: UserView) => {
    setSelectedUser(u);
    loadGrants(u.id);
  };

  const performRevoke = async () => {
    if (!revokeTarget) return;
    try {
      if (revokeTarget.kind === "consent") {
        await revokeConsentGrant(revokeTarget.id);
        showToast(t("consentRevoked"));
      } else {
        await revokeBrokerGrant(revokeTarget.id);
        showToast(t("brokerRevoked"));
      }
      setRevokeTarget(null);
      if (selectedUser) loadGrants(selectedUser.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("revokeFailed"), "error");
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: fonts.mono, fontSize: sz.xl, fontWeight: 600 }}>{t("title")}</div>
        <div style={{ fontSize: sz.base, color: C.textDim, marginTop: 2 }}>
          {t("subtitle")}
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: "8px 14px", background: alpha(C.danger, 0x12), border: `1px solid ${alpha(C.danger, 0x40)}`, borderRadius: 6, fontSize: sz.base, color: C.danger }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 18 }}>
        <Card style={{ padding: 0 }}>
          <div style={{ padding: 14, borderBottom: `1px solid ${C.border}` }}>
            <TextInput placeholder={t("searchUsers")} value={userQuery} onChange={setUserQuery} />
          </div>
          <div style={{ maxHeight: 540, overflowY: "auto" }}>
            {filteredUsers.map((u) => (
              <div
                key={u.id}
                onClick={() => handleSelectUser(u)}
                style={{
                  padding: "10px 14px",
                  borderBottom: `1px solid ${C.border}`,
                  cursor: "pointer",
                  background: selectedUser?.id === u.id ? alpha(C.accent, 0x10) : "transparent",
                  borderLeft: selectedUser?.id === u.id ? `3px solid ${C.accent}` : "3px solid transparent",
                }}
                onMouseEnter={(e) => { if (selectedUser?.id !== u.id) e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={(e) => { if (selectedUser?.id !== u.id) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ fontWeight: 500, fontSize: sz.base }}>{u.name || "—"}</div>
                <div style={{ fontSize: sz.sm, color: C.textDim, fontFamily: fonts.mono }}>{u.email}</div>
              </div>
            ))}
            {filteredUsers.length === 0 && (
              <div style={{ padding: 16, fontSize: sz.sm, color: C.textDim, textAlign: "center" }}>{t("noUsers")}</div>
            )}
          </div>
        </Card>

        <div>
          {!selectedUser ? (
            <Card>
              <div style={{ padding: 20, fontSize: sz.base, color: C.textDim, textAlign: "center" }}>
                {t("selectUser")}
              </div>
            </Card>
          ) : loadingGrants ? (
            <Card>
              <div style={{ padding: 20, fontSize: sz.base, color: C.textDim, textAlign: "center" }}>{t("loading")}</div>
            </Card>
          ) : grants ? (
            <GrantsTables
              grants={grants}
              clients={clients}
              resources={resources}
              providers={providers}
              onRevokeConsent={(g) =>
                setRevokeTarget({
                  kind: "consent",
                  id: g.id,
                  description: t("consentRevokeCopy", { client: clients.find(c => c.id === g.client_id)?.name || g.client_id, resource: resources.find(r => r.id === g.resource_id)?.slug || g.resource_id }),
                })
              }
              onRevokeBroker={(g) =>
                setRevokeTarget({
                  kind: "broker",
                  id: g.id,
                  description: t("brokerRevokeCopy", { user: selectedUser.email || selectedUser.name || selectedUser.id, provider: providers.find(p => p.id === g.broker_provider_id)?.slug || g.broker_provider_id }),
                })
              }
            />
          ) : null}
        </div>
      </div>

      {revokeTarget && (
        <Modal
          title={t("revokeTitle", { kind: t(revokeTarget.kind) })}
          titleColor={C.danger}
          onClose={() => setRevokeTarget(null)}
        >
          <div style={{ fontSize: sz.base, color: C.textDim, lineHeight: 1.7, marginBottom: 16 }}>
            {revokeTarget.description}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn secondary small onClick={() => setRevokeTarget(null)}>{t("cancel")}</Btn>
            <Btn danger small onClick={performRevoke}>{t("revoke")}</Btn>
          </div>
        </Modal>
      )}

      <Toast message={toast?.msg ?? null} type={toast?.type} />
    </div>
  );
}

// ─── GrantsTables — shared rendering ────────────────────────────────────────
//
// Used by Grants.tsx (full-page) and Users.tsx (inside the user detail
// drawer). Same shape, same revoke wiring; the parent owns directory data
// (clients/resources/providers) and the revoke confirmation flow.

interface GrantsTablesProps {
  grants: UserGrantsView;
  clients: ClientView[];
  resources: ResourceView[];
  providers: BrokerProviderView[];
  onRevokeConsent: (g: ConsentGrantView) => void;
  onRevokeBroker: (g: BrokerGrantView) => void;
}

export function GrantsTables({
  grants, clients, resources, providers, onRevokeConsent, onRevokeBroker,
}: GrantsTablesProps) {
  const { t, i18n } = useTranslation("grants");
  const clientName = (id: string): string => {
    const c = clients.find((cl) => cl.id === id);
    return c ? c.name : id;
  };
  const resourceSlug = (id: string): string => {
    const r = resources.find((rr) => rr.id === id);
    return r ? r.slug : id;
  };
  const providerSlug = (id: string): string => {
    const p = providers.find((pp) => pp.id === id);
    return p ? p.slug : id;
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <Card>
        <SectionTitle>{t("consentGrants", { count: grants.consent_grants.length })}</SectionTitle>
        {grants.consent_grants.length === 0 ? (
          <div style={{ fontSize: sz.base, color: C.textDim, padding: "8px 0" }}>{t("noConsentGrants")}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: sz.base }}>
            <thead>
              <tr>
                {[t("agent"), t("resource"), t("scopes"), t("created"), t("status"), ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: C.textDim, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1.2, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grants.consent_grants.map((g) => (
                <tr key={g.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px" }}>
                    <Mono style={{ fontSize: sz.sm }}>{clientName(g.client_id)}</Mono>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <Mono style={{ fontSize: sz.sm }}>{resourceSlug(g.resource_id)}</Mono>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {g.scopes.map((s) => <Tag key={s} color={C.blue}>{s}</Tag>)}
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", color: C.textDim, fontSize: sz.sm }}>
                    {formatDate(g.created_at, i18n.language)}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {g.revoked_at ? (
                      <Tag color={C.danger}>{t("revoked")}</Tag>
                    ) : (
                      <Tag color={C.success}>{t("active")}</Tag>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <a
                        href={`#/issuances?user=${encodeURIComponent(g.user_id)}&client=${encodeURIComponent(g.client_id)}&resource=${encodeURIComponent(g.resource_id)}`}
                        title={t("viewConsentIssuances")}
                        style={grantsCrossLinkStyle}
                      >
                        {t("issuances")}
                      </a>
                      {!g.revoked_at && (
                        <Btn danger small onClick={() => onRevokeConsent(g)}>{t("revoke")}</Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <SectionTitle>{t("brokerGrants", { count: grants.broker_grants.length })}</SectionTitle>
        {grants.broker_grants.length === 0 ? (
          <div style={{ fontSize: sz.base, color: C.textDim, padding: "8px 0" }}>{t("noBrokerGrants")}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: sz.base }}>
            <thead>
              <tr>
                {[t("provider"), t("scopesGranted"), t("version"), t("encBackend"), t("created"), t("status"), ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: C.textDim, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1.2, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grants.broker_grants.map((g) => (
                <tr key={g.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px" }}>
                    <Mono style={{ fontSize: sz.sm }}>{providerSlug(g.broker_provider_id)}</Mono>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {g.scopes_granted.map((s) => <Tag key={s} color={C.purple}>{s}</Tag>)}
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <Mono style={{ fontSize: sz.sm }}>{g.version}</Mono>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <Tag color={C.textDim}>{g.enc_backend}</Tag>
                  </td>
                  <td style={{ padding: "8px 10px", color: C.textDim, fontSize: sz.sm }}>
                    {formatDate(g.created_at, i18n.language)}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {g.revoked_at ? (
                      <Tag color={C.danger}>{t("revoked")}</Tag>
                    ) : (
                      <Tag color={C.success}>{t("active")}</Tag>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <a
                        href={`#/issuances?user=${encodeURIComponent(g.user_id)}`}
                        title={t("viewBrokerIssuances")}
                        style={grantsCrossLinkStyle}
                      >
                        {t("issuances")}
                      </a>
                      {!g.revoked_at && (
                        <Btn danger small onClick={() => onRevokeBroker(g)}>{t("revoke")}</Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// Shared style for the Grants → Issuances cross-link buttons.
const grantsCrossLinkStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "4px 10px",
  borderRadius: 5,
  border: `1px solid ${C.border2}`,
  background: "transparent",
  color: C.accent,
  textDecoration: "none",
  fontFamily: fonts.mono,
  fontSize: sz.sm,
  cursor: "pointer",
};

// Revoke confirmation copy — matches DESIGN_v4 §9 Flow F semantics.
// Honest explanation of cascade scope, not a generic "are you sure?".

type GrantCopyTranslator = ReturnType<typeof useTranslation>["t"];

function consentRevokeCopy(g: ConsentGrantView, clients: ClientView[], resources: ResourceView[], translate?: GrantCopyTranslator): string {
  const c = clients.find((cl) => cl.id === g.client_id);
  const r = resources.find((rr) => rr.id === g.resource_id);
  const clientLabel = c ? c.name : g.client_id;
  const resourceLabel = r ? r.slug : g.resource_id;
  const values = { client: clientLabel, resource: resourceLabel };
  return translate ? translate("consentRevokeCopy", values) : i18n.t("grants:consentRevokeCopy", values);
}

function brokerRevokeCopy(g: BrokerGrantView, providers: BrokerProviderView[], user: UserView, translate?: GrantCopyTranslator): string {
  const p = providers.find((pp) => pp.id === g.broker_provider_id);
  const providerLabel = p ? p.slug : g.broker_provider_id;
  const userLabel = user.email || user.name || user.id;
  const values = { user: userLabel, provider: providerLabel };
  return translate ? translate("brokerRevokeCopy", values) : i18n.t("grants:brokerRevokeCopy", values);
}

export { consentRevokeCopy, brokerRevokeCopy };
