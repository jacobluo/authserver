import { useState, useEffect, useCallback } from "react";
import { C, fonts, sz, alpha } from "../tokens";
import { listClients, suspendClient, revokeClient, reactivateClient, createClient, rotateClientSecret, updateClient } from "../api";
import type { ClientView, CreateClientResponse, RotateSecretResponse, UpdateClientRequest } from "../api";
import Card from "../components/Card";
import Btn from "../components/Btn";
import Tag from "../components/Tag";
import Mono from "../components/Mono";
import StatusDot from "../components/StatusDot";
import TextInput from "../components/TextInput";
import Drawer from "../components/Drawer";
import DrawerRow from "../components/DrawerRow";
import SectionTitle from "../components/SectionTitle";
import Toast from "../components/Toast";
import Modal from "../components/Modal";
import Label from "../components/Label";
import Toggle from "../components/Toggle";
import { useTranslation } from "../i18n";

function truncate(id: string): string {
  return id.length > 8 ? id.substring(0, 8) + "…" : id;
}

function clientType(c: ClientView): string {
  if (c.registration_source === "agent") return "agent";
  if (c.token_endpoint_auth_method === "none") return "public";
  return "confidential";
}

function typeColor(t: string): string {
  if (t === "agent") return C.purple;
  if (t === "confidential") return C.blue;
  return C.textDim;
}

function formatDate(iso: string, locale: string): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

const GRANT_TYPE_OPTIONS = [
  { value: "authorization_code", label: "authorization_code" },
  { value: "client_credentials", label: "client_credentials" },
  { value: "refresh_token", label: "refresh_token" },
];

const AUTH_METHOD_OPTIONS = [
  { value: "client_secret_post", label: "clientSecretPost" },
  { value: "client_secret_basic", label: "clientSecretBasic" },
  { value: "none", label: "nonePublic" },
];

interface ClientFormData {
  name: string;
  redirect_uris: string;
  grant_types: string[];
  token_endpoint_auth_method: string;
  scope: string;
  is_agent: boolean;
  agent_description: string;
}

const emptyForm: ClientFormData = {
  name: "",
  redirect_uris: "",
  grant_types: ["authorization_code"],
  token_endpoint_auth_method: "client_secret_post",
  scope: "",
  is_agent: false,
  agent_description: "",
};

interface EditClientFormData {
  name: string;
  redirect_uris: string;
  grant_types: string[];
  scope: string;
}

export default function Clients() {
  const { t, i18n } = useTranslation("clients");
  const [clients, setClients] = useState<ClientView[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState<ClientView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Create client form state
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ClientFormData>({ ...emptyForm });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  // Secret display modal state
  const [createdResult, setCreatedResult] = useState<CreateClientResponse | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  // Rotate secret state
  const [rotatedResult, setRotatedResult] = useState<RotateSecretResponse | null>(null);
  const [rotatedSecretCopied, setRotatedSecretCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  // Edit client state
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<ClientView | null>(null);
  const [editForm, setEditForm] = useState<EditClientFormData>({ name: "", redirect_uris: "", grant_types: [], scope: "" });
  const [editFormErrors, setEditFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadClients = useCallback(async () => {
    try {
      const data = await listClients({ limit: 200 });
      setClients(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const filtered = clients.filter((c) => {
    const type = clientType(c);
    if (typeFilter !== "all" && type !== typeFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return c.name.toLowerCase().includes(s) || c.id.toLowerCase().includes(s);
    }
    return true;
  });

  const handleSuspend = async (id: string) => {
    try {
      await suspendClient(id);
      showToast(t("clientSuspended"));
      setSelected(null);
      loadClients();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("failed"));
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeClient(id);
      showToast(t("tokensRevoked"));
      setSelected(null);
      loadClients();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("failed"));
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await reactivateClient(id);
      showToast(t("clientReactivated"));
      setSelected(null);
      loadClients();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("failed"));
    }
  };

  const openCreateForm = () => {
    setForm({ ...emptyForm });
    setFormErrors({});
    setShowCreate(true);
  };

  const toggleGrantType = (gt: string) => {
    setForm((f) => {
      const current = f.grant_types;
      if (current.includes(gt)) {
        return { ...f, grant_types: current.filter((g) => g !== gt) };
      }
      return { ...f, grant_types: [...current, gt] };
    });
  };

  const validateForm = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = t("nameRequired");
    if (form.grant_types.length === 0) e.grant_types = t("grantTypeRequired");
    if (!form.token_endpoint_auth_method) e.auth_method = t("authMethodRequired");
    if (form.is_agent && !form.agent_description.trim()) e.agent_description = t("agentDescriptionRequired");
    // Redirect URIs are required for authorization_code grant
    if (form.grant_types.includes("authorization_code")) {
      const uris = form.redirect_uris.split(",").map((s) => s.trim()).filter(Boolean);
      if (uris.length === 0) e.redirect_uris = t("redirectUriRequired");
    }
    setFormErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;
    setCreating(true);
    try {
      const uris = form.redirect_uris.split(",").map((s) => s.trim()).filter(Boolean);
      // Derive response_types from grant_types
      const responseTypes: string[] = [];
      if (form.grant_types.includes("authorization_code")) responseTypes.push("code");
      const resp = await createClient({
        client_name: form.name.trim(),
        redirect_uris: uris,
        grant_types: form.grant_types,
        response_types: responseTypes,
        token_endpoint_auth_method: form.token_endpoint_auth_method,
        scope: form.scope.trim(),
        agent: form.is_agent,
        agent_description: form.agent_description.trim(),
      });
      setShowCreate(false);
      setCreatedResult(resp);
      setSecretCopied(false);
      loadClients();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const handleCopySecret = async () => {
    if (!createdResult?.client_secret) return;
    try {
      await navigator.clipboard.writeText(createdResult.client_secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      // Fallback: select the text for manual copy
      showToast(t("copyFailed"));
    }
  };

  const handleDismissSecret = () => {
    setCreatedResult(null);
    showToast(t("clientCreatedSuccess"));
  };

  const handleRotateSecret = async (id: string) => {
    setRotating(true);
    try {
      const resp = await rotateClientSecret(id);
      setRotatedResult(resp);
      setRotatedSecretCopied(false);
      setSelected(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("rotateFailed"));
    } finally {
      setRotating(false);
    }
  };

  const handleCopyRotatedSecret = async () => {
    if (!rotatedResult?.client_secret) return;
    try {
      await navigator.clipboard.writeText(rotatedResult.client_secret);
      setRotatedSecretCopied(true);
      setTimeout(() => setRotatedSecretCopied(false), 2000);
    } catch {
      showToast(t("copyFailed"));
    }
  };

  const handleDismissRotatedSecret = () => {
    setRotatedResult(null);
    showToast(t("secretRotatedSuccess"));
  };

  const openEditForm = (client: ClientView) => {
    setEditTarget(client);
    setEditForm({
      name: client.name,
      redirect_uris: client.redirect_uris.join(", "),
      grant_types: [...client.grant_types],
      scope: "", // scope is not exposed on ClientView; user fills in if needed
    });
    setEditFormErrors({});
    setSelected(null);
    setShowEdit(true);
  };

  const toggleEditGrantType = (gt: string) => {
    setEditForm((f) => {
      const current = f.grant_types;
      if (current.includes(gt)) {
        return { ...f, grant_types: current.filter((g) => g !== gt) };
      }
      return { ...f, grant_types: [...current, gt] };
    });
  };

  const validateEditForm = (): boolean => {
    const e: Record<string, string> = {};
    if (!editForm.name.trim()) e.name = t("nameRequired");
    if (editForm.grant_types.length === 0) e.grant_types = t("grantTypeRequired");
    if (editForm.grant_types.includes("authorization_code")) {
      const uris = editForm.redirect_uris.split(",").map((s) => s.trim()).filter(Boolean);
      if (uris.length === 0) e.redirect_uris = t("redirectUriRequired");
    }
    setEditFormErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleEdit = async () => {
    if (!editTarget || !validateEditForm()) return;
    setSaving(true);
    try {
      const uris = editForm.redirect_uris.split(",").map((s) => s.trim()).filter(Boolean);
      const req: UpdateClientRequest = {};
      // Only include fields that changed
      if (editForm.name.trim() !== editTarget.name) {
        req.client_name = editForm.name.trim();
      }
      const oldUris = editTarget.redirect_uris.join(", ");
      const newUris = uris.join(", ");
      if (newUris !== oldUris) {
        req.redirect_uris = uris;
      }
      if (JSON.stringify(editForm.grant_types.sort()) !== JSON.stringify([...editTarget.grant_types].sort())) {
        req.grant_types = editForm.grant_types;
      }
      if (editForm.scope.trim()) {
        req.scope = editForm.scope.trim();
      }
      // Only call API if there are actual changes
      if (Object.keys(req).length === 0) {
        showToast(t("noChanges"));
        setShowEdit(false);
        return;
      }
      await updateClient(editTarget.id, req);
      setShowEdit(false);
      setEditTarget(null);
      showToast(t("clientUpdatedSuccess"));
      loadClients();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("updateFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: sz.xl, fontWeight: 600, fontFamily: fonts.mono }}>{t("title")}</div>
          <div style={{ fontSize: sz.base, color: C.textDim, marginTop: 2 }}>
            {t("registeredClients", { total: clients.length })}
          </div>
        </div>
        <Btn onClick={openCreateForm}>{t("createClientButton")}</Btn>
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: "8px 14px", background: alpha(C.danger, 0x12), border: `1px solid ${alpha(C.danger, 0x40)}`, borderRadius: 6, fontSize: sz.base, color: C.danger }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <TextInput placeholder={t("searchPlaceholder")} value={search} onChange={setSearch} style={{ width: 260 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {["all", "public", "confidential", "agent"].map((filterType) => (
            <button
              key={filterType}
              onClick={() => setTypeFilter(filterType)}
              style={{
                padding: "5px 12px",
                borderRadius: 5,
                border: `1px solid ${typeFilter === filterType ? alpha(filterType === "agent" ? C.purple : C.accent, 0x50) : C.border2}`,
                background: typeFilter === filterType ? alpha(filterType === "agent" ? C.purple : C.accent, 0x18) : "transparent",
                color: typeFilter === filterType ? (filterType === "agent" ? C.purple : C.accent) : C.textDim,
                cursor: "pointer",
                fontFamily: fonts.mono,
                fontSize: sz.sm,
                textTransform: "uppercase",
              }}
            >
              {filterType === "all" ? t("all") : t(`typeValue.${filterType}`)}
            </button>
          ))}
        </div>
      </div>

      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: sz.base }}>
          <thead>
            <tr>
              {[t("id"), t("name"), t("type"), t("grantTypes"), t("status"), t("updated")].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: C.textDim, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1.2, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const type = clientType(c);
              return (
                <tr
                  key={c.id}
                  onClick={() => setSelected(c)}
                  style={{ cursor: "pointer", borderBottom: `1px solid ${C.border}`, transition: "background 0.1s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.surface2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <td style={{ padding: "10px 12px" }}><Mono>{truncate(c.id)}</Mono></td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 500 }}>{c.name}</span>
                      {type === "agent" && <Tag color={C.purple}>{t("agent")}</Tag>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}><Tag color={typeColor(type)}>{t(`typeValue.${type}`)}</Tag></td>
                  <td style={{ padding: "10px 12px" }}><Mono style={{ fontSize: sz.sm }}>{c.grant_types.join(", ")}</Mono></td>
                  <td style={{ padding: "10px 12px" }}><StatusDot status={c.status} /><span style={{ fontSize: sz.base, color: C.textDim }}>{t(`statusValue.${c.status}`, { defaultValue: c.status })}</span></td>
                  <td style={{ padding: "10px 12px" }}><span style={{ fontSize: sz.base, color: C.textDim }}>{formatDate(c.updated_at, i18n.language)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: "20px 12px", fontSize: sz.base, color: C.textDim, textAlign: "center" }}>
            {clients.length === 0 ? t("noClients") : t("noFilterResults")}
          </div>
        )}
      </Card>

      {/* Client Detail Drawer */}
      {selected && (
        <Drawer title={t("clientDetail")} subtitle={selected.name} onClose={() => setSelected(null)} width={500}>
          <DrawerRow label={t("clientId")} value={<Mono style={{ fontSize: sz.sm }}>{selected.id}</Mono>} />
          <DrawerRow label={t("name")} value={selected.name} />
          <DrawerRow label={t("type")} value={<Tag color={typeColor(clientType(selected))}>{t(`typeValue.${clientType(selected)}`)}</Tag>} />
          <DrawerRow label={t("grantTypes")} value={
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {selected.grant_types.map((g) => <Tag key={g} color={C.blue}>{g}</Tag>)}
            </div>
          } />
          <DrawerRow label={t("responseTypes")} value={
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {selected.response_types.map((r) => <Tag key={r} color={C.textDim}>{r}</Tag>)}
            </div>
          } />
          <DrawerRow label={t("authMethod")} value={<Mono>{selected.token_endpoint_auth_method}</Mono>} />
          <DrawerRow label={t("status")} value={<><StatusDot status={selected.status} />{t(`statusValue.${selected.status}`, { defaultValue: selected.status })}</>} />
          <DrawerRow label={t("redirectUris")} value={
            selected.redirect_uris.length > 0
              ? <div>{selected.redirect_uris.map((u) => <div key={u}><Mono style={{ fontSize: sz.sm }}>{u}</Mono></div>)}</div>
              : <span style={{ color: C.textDim }}>{t("none")}</span>
          } />
          <DrawerRow label={t("registration")} value={t(`registrationValue.${selected.registration_source}`, { defaultValue: selected.registration_source })} />
          <DrawerRow label={t("issuedAt")} value={formatDate(selected.issued_at, i18n.language)} />
          <DrawerRow label={t("updatedAt")} value={formatDate(selected.updated_at, i18n.language)} />
          {selected.cimd_url && <DrawerRow label={t("cimdUrl")} value={<Mono style={{ fontSize: sz.sm }}>{selected.cimd_url}</Mono>} />}

          <div style={{ marginTop: 20 }}>
            <SectionTitle>{t("actions")}</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Btn secondary small full onClick={() => openEditForm(selected)}>{t("editClient")}</Btn>
              {selected.token_endpoint_auth_method !== "none" && (
                <Btn secondary small full onClick={() => handleRotateSecret(selected.id)} disabled={rotating}>
                  {rotating ? t("rotating") : t("rotateSecret")}
                </Btn>
              )}
              {selected.status === "active" ? (
                <Btn secondary small full onClick={() => handleSuspend(selected.id)}>{t("suspendClient")}</Btn>
              ) : selected.status === "suspended" ? (
                <Btn secondary small full onClick={() => handleReactivate(selected.id)}>{t("reactivateClient")}</Btn>
              ) : null}
              <Btn danger small full onClick={() => handleRevoke(selected.id)}>{t("revokeAllTokens")}</Btn>
            </div>
          </div>
        </Drawer>
      )}

      {/* Create Client Drawer */}
      {showCreate && (
        <Drawer title={t("createClient")} onClose={() => setShowCreate(false)} width={520}>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <Label>{t("clientNameRequired")}</Label>
              <TextInput placeholder={t("namePlaceholder")} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
              {formErrors.name && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{formErrors.name}</div>}
            </div>

            <div>
              <Label>{t("redirectUrisComma")}</Label>
              <TextInput placeholder={t("redirectUrisPlaceholder")} value={form.redirect_uris} onChange={(v) => setForm((f) => ({ ...f, redirect_uris: v }))} />
              {formErrors.redirect_uris && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{formErrors.redirect_uris}</div>}
              <div style={{ fontSize: sz.sm, color: C.textDim, marginTop: 4 }}>{t("redirectUrisHint")}</div>
            </div>

            <div>
              <Label>{t("grantTypesRequired")}</Label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {GRANT_TYPE_OPTIONS.map((gt) => (
                  <button
                    key={gt.value}
                    onClick={() => toggleGrantType(gt.value)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 5,
                      border: `1px solid ${form.grant_types.includes(gt.value) ? alpha(C.accent, 0x50) : C.border2}`,
                      background: form.grant_types.includes(gt.value) ? alpha(C.accent, 0x18) : "transparent",
                      color: form.grant_types.includes(gt.value) ? C.accent : C.textDim,
                      cursor: "pointer",
                      fontFamily: fonts.mono,
                      fontSize: sz.sm,
                    }}
                  >
                    {gt.label}
                  </button>
                ))}
              </div>
              {formErrors.grant_types && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{formErrors.grant_types}</div>}
            </div>

            <div>
              <Label>{t("tokenEndpointAuthMethodRequired")}</Label>
              <select
                value={form.token_endpoint_auth_method}
                onChange={(e) => setForm((f) => ({ ...f, token_endpoint_auth_method: e.target.value }))}
                style={{
                  width: "100%",
                  padding: "6px 12px",
                  background: C.surface2,
                  border: `1px solid ${C.border2}`,
                  borderRadius: 5,
                  color: C.text,
                  fontSize: sz.base,
                  fontFamily: fonts.mono,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              >
                {AUTH_METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
                ))}
              </select>
              {formErrors.auth_method && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{formErrors.auth_method}</div>}
              <div style={{ fontSize: sz.sm, color: C.textDim, marginTop: 4 }}>
                {form.token_endpoint_auth_method === "none"
                  ? t("publicClientHint")
                  : t("confidentialClientHint")}
              </div>
            </div>

            <div>
              <Label>{t("scopeSpaceSeparated")}</Label>
              <TextInput placeholder={t("scopePlaceholder")} value={form.scope} onChange={(v) => setForm((f) => ({ ...f, scope: v }))} />
              <div style={{ fontSize: sz.sm, color: C.textDim, marginTop: 4 }}>{t("scopeCreateHint")}</div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <Toggle checked={form.is_agent} onChange={(v) => setForm((f) => ({ ...f, is_agent: v }))} />
              <div style={{ fontSize: sz.base, color: C.textDim }}>{form.is_agent ? t("agentClientHint") : t("standardClientHint")}</div>
            </div>

            {form.is_agent && (
              <div>
                <Label>{t("agentDescriptionRequiredLabel")}</Label>
                <TextInput rows={2} placeholder={t("agentDescriptionPlaceholder")} value={form.agent_description} onChange={(v) => setForm((f) => ({ ...f, agent_description: v }))} />
                {formErrors.agent_description && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{formErrors.agent_description}</div>}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <Btn secondary onClick={() => setShowCreate(false)}>{t("cancel")}</Btn>
            <Btn onClick={handleCreate} disabled={creating}>{creating ? t("creating") : t("createClient")}</Btn>
          </div>
        </Drawer>
      )}

      {/* Edit Client Drawer */}
      {showEdit && editTarget && (
        <Drawer title={t("editClient")} subtitle={editTarget.name} onClose={() => setShowEdit(false)} width={520}>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <Label>{t("clientNameRequired")}</Label>
              <TextInput placeholder={t("namePlaceholder")} value={editForm.name} onChange={(v) => setEditForm((f) => ({ ...f, name: v }))} />
              {editFormErrors.name && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{editFormErrors.name}</div>}
            </div>

            <div>
              <Label>{t("redirectUrisComma")}</Label>
              <TextInput placeholder={t("redirectUrisPlaceholder")} value={editForm.redirect_uris} onChange={(v) => setEditForm((f) => ({ ...f, redirect_uris: v }))} />
              {editFormErrors.redirect_uris && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{editFormErrors.redirect_uris}</div>}
              <div style={{ fontSize: sz.sm, color: C.textDim, marginTop: 4 }}>{t("redirectUrisHint")}</div>
            </div>

            <div>
              <Label>{t("grantTypesRequired")}</Label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {GRANT_TYPE_OPTIONS.map((gt) => (
                  <button
                    key={gt.value}
                    onClick={() => toggleEditGrantType(gt.value)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 5,
                      border: `1px solid ${editForm.grant_types.includes(gt.value) ? alpha(C.accent, 0x50) : C.border2}`,
                      background: editForm.grant_types.includes(gt.value) ? alpha(C.accent, 0x18) : "transparent",
                      color: editForm.grant_types.includes(gt.value) ? C.accent : C.textDim,
                      cursor: "pointer",
                      fontFamily: fonts.mono,
                      fontSize: sz.sm,
                    }}
                  >
                    {gt.label}
                  </button>
                ))}
              </div>
              {editFormErrors.grant_types && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{editFormErrors.grant_types}</div>}
            </div>

            <div>
              <Label>{t("scopeSpaceSeparated")}</Label>
              <TextInput placeholder={t("scopePlaceholder")} value={editForm.scope} onChange={(v) => setEditForm((f) => ({ ...f, scope: v }))} />
              <div style={{ fontSize: sz.sm, color: C.textDim, marginTop: 4 }}>{t("scopeEditHint")}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <Btn secondary onClick={() => setShowEdit(false)}>{t("cancel")}</Btn>
            <Btn onClick={handleEdit} disabled={saving}>{saving ? t("saving") : t("saveChanges")}</Btn>
          </div>
        </Drawer>
      )}

      {/* Client Secret Display Modal — shown once after creation */}
      {createdResult && (
        <Modal title={t("clientCreated")} titleColor={C.success} width={540} onClose={handleDismissSecret}>
          <div style={{ fontSize: sz.base, color: C.textDim, lineHeight: 1.8, marginBottom: 16 }}>
            {t("createdMessage", { name: createdResult.client_name })}
          </div>

          <div style={{ marginBottom: 12 }}>
            <Label>{t("clientId")}</Label>
            <div style={{
              padding: "8px 12px",
              background: C.surface2,
              border: `1px solid ${C.border2}`,
              borderRadius: 5,
              fontFamily: fonts.mono,
              fontSize: sz.sm,
              color: C.text,
              wordBreak: "break-all",
            }}>
              {createdResult.client_id}
            </div>
          </div>

          {createdResult.client_secret && (
            <div style={{ marginBottom: 16 }}>
              <Label>{t("clientSecret")}</Label>
              <div style={{
                padding: "10px 12px",
                background: alpha(C.warn, 0x12),
                border: `1px solid ${alpha(C.warn, 0x40)}`,
                borderRadius: 5,
                marginBottom: 8,
              }}>
                <div style={{
                  fontFamily: fonts.mono,
                  fontSize: sz.sm,
                  color: C.text,
                  wordBreak: "break-all",
                  marginBottom: 8,
                  userSelect: "all",
                }}>
                  {createdResult.client_secret}
                </div>
                <Btn small onClick={handleCopySecret}>
                  {secretCopied ? t("copied") : t("copyToClipboard")}
                </Btn>
              </div>
              <div style={{
                fontSize: sz.sm,
                color: C.warn,
                fontWeight: 600,
                lineHeight: 1.6,
              }}>
                {t("oneTimeSecretWarning")}
              </div>
            </div>
          )}

          {!createdResult.client_secret && (
            <div style={{
              padding: "8px 14px",
              background: alpha(C.blue, 0x12),
              border: `1px solid ${alpha(C.blue, 0x40)}`,
              borderRadius: 6,
              fontSize: sz.sm,
              color: C.blue,
              marginBottom: 16,
            }}>
              {t("noSecretGenerated")}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Btn onClick={handleDismissSecret}>{t("done")}</Btn>
          </div>
        </Modal>
      )}

      {/* Rotated Secret Display Modal — shown once after rotation */}
      {rotatedResult && (
        <Modal title={t("secretRotated")} titleColor={C.success} width={540} onClose={handleDismissRotatedSecret}>
          <div style={{ fontSize: sz.base, color: C.textDim, lineHeight: 1.8, marginBottom: 16 }}>
            {t("rotatedMessage", { id: rotatedResult.client_id })}
          </div>

          <div style={{ marginBottom: 12 }}>
            <Label>{t("clientId")}</Label>
            <div style={{
              padding: "8px 12px",
              background: C.surface2,
              border: `1px solid ${C.border2}`,
              borderRadius: 5,
              fontFamily: fonts.mono,
              fontSize: sz.sm,
              color: C.text,
              wordBreak: "break-all",
            }}>
              {rotatedResult.client_id}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Label>{t("newClientSecret")}</Label>
            <div style={{
              padding: "10px 12px",
              background: alpha(C.warn, 0x12),
              border: `1px solid ${alpha(C.warn, 0x40)}`,
              borderRadius: 5,
              marginBottom: 8,
            }}>
              <div style={{
                fontFamily: fonts.mono,
                fontSize: sz.sm,
                color: C.text,
                wordBreak: "break-all",
                marginBottom: 8,
                userSelect: "all",
              }}>
                {rotatedResult.client_secret}
              </div>
              <Btn small onClick={handleCopyRotatedSecret}>
                {rotatedSecretCopied ? t("copied") : t("copyToClipboard")}
              </Btn>
            </div>
            <div style={{
              fontSize: sz.sm,
              color: C.warn,
              fontWeight: 600,
              lineHeight: 1.6,
            }}>
              {t("rotatedSecretWarning")}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Btn onClick={handleDismissRotatedSecret}>{t("done")}</Btn>
          </div>
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  );
}
