// Resources.tsx — admin surface for the unified Resource model.
//
// A Resource is either Mint (Authplane mints JWTs for it) or Broker
// (Authplane vends an upstream credential). The page is intentionally a
// flat list, not a tabbed sub-section, because Mint and Broker resources
// are conceptually one thing — first-class resources of the system —
// distinguished only by backend kind. Filter by backend_kind narrows the
// list but does not split the surface.
//
// PATCH-semantics is load-bearing in the edit form. See `dirty` tracking
// in the openEdit + handleSave paths and the dedicated "Clear allowlist"
// button. Forgetting to interact with policy.exchange.allowed_client_ids
// MUST NOT silently widen the resource — the field is omitted from the
// PATCH body unless the operator touches it. Backstop:
// TestAdmin_Resources_Patch_OmittedPolicy_DoesNotWiden.

import { useState, useEffect, useCallback, ReactNode } from "react";
import { C, fonts, sz, alpha } from "../tokens";
import {
  listResources, createResource, patchResource, deleteResource,
  listBrokerProviders, listClients, isApiError,
} from "../api";
import type {
  ResourceView, ScopeView, PolicyView, ResourcePatch, BackendKind,
  BrokerProviderView, ClientView, CreateResourceRequest, FrontingLinkView,
} from "../api";
import ResourceFrontingSection, {
  ScopeFrontingBadge,
} from "../components/ResourceFrontingSection";
import type { ScopePerLinkCounts } from "../components/ResourceFrontingSection";
import Btn from "../components/Btn";
import Card from "../components/Card";
import Label from "../components/Label";
import Mono from "../components/Mono";
import Tag from "../components/Tag";
import TextInput from "../components/TextInput";
import Drawer from "../components/Drawer";
import Modal from "../components/Modal";
import Toast from "../components/Toast";
import InfoBox from "../components/InfoBox";
import { useTranslation } from "../i18n";

interface ScopeRow {
  name: string;
  description: string;
  upstream: string;
}

interface ResourceForm {
  slug: string;
  uri: string;
  backend_kind: BackendKind;
  broker_provider_id: string;
  display_name: string;
  scopes: ScopeRow[];
  allowed_client_ids: string[];
  runtime_client_ids: string[];
  allowed_return_urls: string[];
}

const emptyForm: ResourceForm = {
  slug: "",
  uri: "",
  backend_kind: "mint",
  broker_provider_id: "",
  display_name: "",
  scopes: [],
  allowed_client_ids: [],
  runtime_client_ids: [],
  allowed_return_urls: [],
};

// dirtyFields tracks which top-level form sections the operator has
// modified. Only dirty sections appear in the PATCH body — this is the
// security guard against silent widening.
type DirtyField =
  | "slug"
  | "uri"
  | "backend_kind"
  | "broker_provider_id"
  | "display_name"
  | "scopes"
  | "allowed_client_ids"
  | "runtime_client_ids"
  | "allowed_return_urls";

const formFromView = (r: ResourceView): ResourceForm => ({
  slug: r.slug,
  uri: r.uri,
  backend_kind: r.backend_kind,
  broker_provider_id: r.broker_provider_id,
  display_name: r.display_name,
  scopes: r.scopes.map((s) => ({
    name: s.name,
    description: s.description ?? "",
    upstream: s.upstream ?? "",
  })),
  allowed_client_ids: [...(r.policy.exchange.allowed_client_ids ?? [])],
  runtime_client_ids: [...(r.policy.runtime?.client_ids ?? [])],
  allowed_return_urls: [...(r.policy.connect?.allowed_return_urls ?? [])],
});

const scopesFromForm = (rows: ScopeRow[], kind: BackendKind): ScopeView[] =>
  rows
    .map((row) => ({
      name: row.name.trim(),
      description: row.description.trim(),
      // Upstream is meaningful only for Broker scopes; Mint resources
      // omit the Upstream column entirely (and drop any inherited value).
      upstream: kind === "broker" ? row.upstream.trim() : "",
    }))
    .filter((s) => s.name !== "");

export default function Resources() {
  const { t } = useTranslation("resources");
  const [resources, setResources] = useState<ResourceView[]>([]);
  const [providers, setProviders] = useState<BrokerProviderView[]>([]);
  const [clients, setClients] = useState<ClientView[]>([]);
  const [filter, setFilter] = useState<"all" | BackendKind>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const [editing, setEditing] = useState<ResourceView | "new" | null>(null);
  const [form, setForm] = useState<ResourceForm>(emptyForm);
  const [initialForm, setInitialForm] = useState<ResourceForm>(emptyForm);
  const [dirty, setDirty] = useState<Set<DirtyField>>(new Set());
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [pendingKindSwitch, setPendingKindSwitch] = useState<BackendKind | null>(null);
  const [confirmingClearAllowlist, setConfirmingClearAllowlist] = useState(false);

  const [delTarget, setDelTarget] = useState<ResourceView | null>(null);
  const [delInput, setDelInput] = useState("");
  const [cascadeModal, setCascadeModal] = useState<{
    target: ResourceView;
    dependents: FrontingLinkView[];
    confirmInput: string;
  } | null>(null);
  const [scopeCounts, setScopeCounts] = useState<ScopePerLinkCounts>({});

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const markDirty = (field: DirtyField) => {
    setDirty((d) => {
      if (d.has(field)) return d;
      const next = new Set(d);
      next.add(field);
      return next;
    });
  };

  const load = useCallback(async () => {
    try {
      const [rs, ps, cs] = await Promise.all([
        listResources(),
        listBrokerProviders(),
        listClients(),
      ]);
      setResources(rs);
      setProviders(ps);
      setClients(cs);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const providerSlug = (id: string): string => {
    const p = providers.find((pr) => pr.id === id);
    return p ? p.slug : id;
  };

  const filtered = resources.filter((r) => {
    if (filter !== "all" && r.backend_kind !== filter) return false;
    if (!search) return true;
    const t = search.toLowerCase();
    return (
      r.slug.toLowerCase().includes(t) ||
      r.uri.toLowerCase().includes(t) ||
      r.display_name.toLowerCase().includes(t) ||
      providerSlug(r.broker_provider_id).toLowerCase().includes(t)
    );
  });

  const openCreate = () => {
    setForm(emptyForm);
    setInitialForm(emptyForm);
    setDirty(new Set());
    setFormErrors({});
    setEditing("new");
  };

  const openEdit = (r: ResourceView) => {
    const f = formFromView(r);
    setForm(f);
    setInitialForm(f);
    setDirty(new Set());
    setFormErrors({});
    setEditing(r);
  };

  const closeEditor = () => {
    setEditing(null);
    setDirty(new Set());
    setFormErrors({});
    setPendingKindSwitch(null);
    setConfirmingClearAllowlist(false);
    setScopeCounts({});
  };

  const requestKindSwitch = (next: BackendKind) => {
    if (form.backend_kind === next) return;
    // Switching broker -> mint loses the per-scope Upstream values; warn.
    if (form.backend_kind === "broker" && next === "mint" && form.scopes.some((s) => s.upstream.trim() !== "")) {
      setPendingKindSwitch(next);
      return;
    }
    applyKindSwitch(next);
  };

  const applyKindSwitch = (next: BackendKind) => {
    setForm((f) => ({
      ...f,
      backend_kind: next,
      // Clear broker_provider_id when switching to mint; the field is
      // unused for Mint resources and the server rejects non-empty values.
      broker_provider_id: next === "mint" ? "" : f.broker_provider_id,
    }));
    markDirty("backend_kind");
    if (next === "mint") {
      // Mint resources have no upstream mapping; strip values we'd
      // otherwise carry over silently.
      setForm((f) => ({
        ...f,
        scopes: f.scopes.map((s) => ({ ...s, upstream: "" })),
      }));
      markDirty("scopes");
      // Connect policy is only meaningful for Broker; clearing it on
      // kind-switch matches the server's PolicyToView(includeConnect=false)
      // emission for Mint.
      if (form.allowed_return_urls.length > 0) {
        setForm((f) => ({ ...f, allowed_return_urls: [] }));
        markDirty("allowed_return_urls");
      }
    }
    setPendingKindSwitch(null);
  };

  const addScope = () => {
    setForm((f) => ({ ...f, scopes: [...f.scopes, { name: "", description: "", upstream: "" }] }));
    markDirty("scopes");
  };
  const removeScope = (i: number) => {
    setForm((f) => ({ ...f, scopes: f.scopes.filter((_, idx) => idx !== i) }));
    markDirty("scopes");
  };
  const updateScope = (i: number, field: keyof ScopeRow, value: string) => {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)),
    }));
    markDirty("scopes");
  };

  const toggleAllowedClient = (clientId: string) => {
    setForm((f) => ({
      ...f,
      allowed_client_ids: f.allowed_client_ids.includes(clientId)
        ? f.allowed_client_ids.filter((c) => c !== clientId)
        : [...f.allowed_client_ids, clientId],
    }));
    markDirty("allowed_client_ids");
  };

  const clearAllowlist = () => {
    setForm((f) => ({ ...f, allowed_client_ids: [] }));
    markDirty("allowed_client_ids");
    setConfirmingClearAllowlist(false);
  };

  const toggleRuntimeClient = (clientId: string) => {
    setForm((f) => ({
      ...f,
      runtime_client_ids: f.runtime_client_ids.includes(clientId)
        ? f.runtime_client_ids.filter((c) => c !== clientId)
        : [...f.runtime_client_ids, clientId],
    }));
    markDirty("runtime_client_ids");
  };

  const addReturnUrl = () => {
    setForm((f) => ({ ...f, allowed_return_urls: [...f.allowed_return_urls, ""] }));
    markDirty("allowed_return_urls");
  };
  const removeReturnUrl = (i: number) => {
    setForm((f) => ({ ...f, allowed_return_urls: f.allowed_return_urls.filter((_, idx) => idx !== i) }));
    markDirty("allowed_return_urls");
  };
  const updateReturnUrl = (i: number, value: string) => {
    setForm((f) => ({
      ...f,
      allowed_return_urls: f.allowed_return_urls.map((u, idx) => (idx === i ? value : u)),
    }));
    markDirty("allowed_return_urls");
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.slug.trim()) e.slug = t("slugRequired");
    if (!form.uri.trim()) e.uri = t("uriRequired");
    else {
      try {
        const u = new URL(form.uri.trim());
        if (!["http:", "https:"].includes(u.protocol)) e.uri = t("uriHttpRequired");
      } catch {
        e.uri = t("uriInvalid");
      }
    }
    if (!form.display_name.trim()) e.display_name = t("nameRequired");
    if (form.backend_kind === "broker" && !form.broker_provider_id) {
      e.broker_provider_id = t("providerRequired");
    }
    const cleanScopes = form.scopes.filter((s) => s.name.trim() !== "");
    if (cleanScopes.length === 0) e.scopes = t("scopeRequired");
    const seen = new Set<string>();
    for (const s of cleanScopes) {
      if (seen.has(s.name.trim())) {
        e.scopes = t("duplicateScope", { name: s.name.trim() });
        break;
      }
      seen.add(s.name.trim());
    }
    if (form.backend_kind === "broker") {
      for (const s of cleanScopes) {
        if (s.upstream.trim() === "") {
          e.scopes = t("scopeNeedsUpstream", { name: s.name.trim() });
          break;
        }
      }
    }
    setFormErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    const scopes = scopesFromForm(form.scopes, form.backend_kind);
    const policy: PolicyView = {
      exchange: { allowed_client_ids: form.allowed_client_ids },
      runtime: { client_ids: form.runtime_client_ids },
    };
    if (form.backend_kind === "broker") {
      policy.connect = { allowed_return_urls: form.allowed_return_urls };
    }
    const req: CreateResourceRequest = {
      slug: form.slug.trim(),
      uri: form.uri.trim(),
      backend_kind: form.backend_kind,
      display_name: form.display_name.trim(),
      scopes,
      policy,
    };
    if (form.backend_kind === "broker") {
      req.broker_provider_id = form.broker_provider_id;
    }
    try {
      await createResource(req);
      showToast(t("created", { slug: req.slug }));
      closeEditor();
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("createFailed"), "error");
    }
  };

  const handlePatch = async (target: ResourceView) => {
    if (!validate()) return;
    const patch: ResourcePatch = {};
    // Per-field dirty check — `initialForm` lets us skip fields the
    // operator only touched and reverted (still in dirty set, but no
    // wire delta); the load-bearing rule is "send only what changed".
    if (dirty.has("slug") && form.slug.trim() !== initialForm.slug) patch.slug = form.slug.trim();
    if (dirty.has("uri") && form.uri.trim() !== initialForm.uri) patch.uri = form.uri.trim();
    if (dirty.has("display_name") && form.display_name.trim() !== initialForm.display_name) {
      patch.display_name = form.display_name.trim();
    }
    if (dirty.has("backend_kind") && form.backend_kind !== initialForm.backend_kind) {
      patch.backend_kind = form.backend_kind;
    }
    if (dirty.has("broker_provider_id") && form.broker_provider_id !== initialForm.broker_provider_id) {
      patch.broker_provider_id = form.broker_provider_id;
    }
    if (dirty.has("scopes")) {
      patch.scopes = scopesFromForm(form.scopes, form.backend_kind);
    }
    if (
      dirty.has("allowed_client_ids") ||
      dirty.has("runtime_client_ids") ||
      dirty.has("allowed_return_urls")
    ) {
      const policy: PolicyView = {
        exchange: { allowed_client_ids: form.allowed_client_ids },
        runtime: { client_ids: form.runtime_client_ids },
      };
      if (form.backend_kind === "broker") {
        policy.connect = { allowed_return_urls: form.allowed_return_urls };
      }
      patch.policy = policy;
    }
    if (Object.keys(patch).length === 0) {
      showToast(t("noChanges"));
      return;
    }
    try {
      await patchResource(target.id, patch);
      showToast(t("updated"));
      closeEditor();
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("updateFailed"), "error");
    }
  };

  const handleDelete = async () => {
    if (!delTarget) return;
    try {
      await deleteResource(delTarget.id);
      showToast(t("deleted"));
      setDelTarget(null);
      setDelInput("");
      load();
    } catch (err) {
      if (isApiError(err) && err.status === 409 && hasDependents(err.body)) {
        const body = err.body as {
          dependents: FrontingLinkView[];
        };
        setCascadeModal({
          target: delTarget,
          dependents: body.dependents,
          confirmInput: "",
        });
        setDelTarget(null);
        setDelInput("");
        return;
      }
      showToast(
        err instanceof Error ? err.message : t("deleteFailed"),
        "error",
      );
    }
  };

  const handleCascadeDelete = async () => {
    if (!cascadeModal) return;
    try {
      await deleteResource(cascadeModal.target.id, { cascade: true });
      showToast(
        t("cascadeDeleted", { count: cascadeModal.dependents.length }),
      );
      setCascadeModal(null);
      load();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : t("cascadeDeleteFailed"),
        "error",
      );
      setCascadeModal(null);
    }
  };

  function hasDependents(body: unknown): boolean {
    return (
      typeof body === "object" &&
      body !== null &&
      "dependents" in body &&
      Array.isArray((body as { dependents: unknown }).dependents)
    );
  }

  const formClientName = (id: string): string => {
    const c = clients.find((cl) => cl.id === id);
    return c ? c.name : id;
  };

  const buildRow = (r: ResourceView): ReactNode[] => [
    <span style={{ fontWeight: 500 }}>{r.slug}</span>,
    <span>
      {r.display_name || <span style={{ color: C.textDim }}>{"—"}</span>}
    </span>,
    <Tag color={r.backend_kind === "mint" ? C.blue : C.purple}>{t(`backendValue.${r.backend_kind}`)}</Tag>,
    <Mono>{r.uri}</Mono>,
    <span>
      {r.backend_kind === "broker"
        ? <Mono style={{ fontSize: sz.sm }}>{providerSlug(r.broker_provider_id)}</Mono>
        : <span style={{ color: C.textDim }}>{"—"}</span>}
    </span>,
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {r.scopes.map((s) => <Tag key={s.name} color={C.textDim}>{s.name}</Tag>)}
    </div>,
  ];

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ width: 280 }}>
            <TextInput placeholder={t("searchPlaceholder")} value={search} onChange={setSearch} />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {(["all", "mint", "broker"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setFilter(opt)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 5,
                  border: `1px solid ${filter === opt ? alpha(C.accent, 0x50) : C.border2}`,
                  background: filter === opt ? alpha(C.accent, 0x18) : "transparent",
                  color: filter === opt ? C.accent : C.textDim,
                  cursor: "pointer",
                  fontFamily: fonts.mono,
                  fontSize: sz.sm,
                  transition: "all 0.15s",
                }}
              >
                {t(`filter.${opt}`)}
              </button>
            ))}
          </div>
        </div>
        <Btn onClick={openCreate}>{t("newResource")}</Btn>
      </div>

      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: sz.base }}>
          <thead>
            <tr>
              {[t("slug"), t("displayName"), t("backend"), "URI", t("provider"), t("scopes")].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: C.textDim, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1.2, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                onClick={() => openEdit(r)}
                style={{ cursor: "pointer", borderBottom: `1px solid ${C.border}`, transition: "background 0.1s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {buildRow(r).map((cell, j) => (
                  <td key={j} style={{ padding: "10px 12px", verticalAlign: "middle" }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: "20px 12px", fontSize: sz.base, color: C.textDim, textAlign: "center" }}>
            {resources.length === 0
              ? t("empty")
              : t("noMatches")}
          </div>
        )}
      </Card>

      {editing && (
        <Drawer
          title={editing === "new" ? t("newResourceTitle") : t("editResourceTitle")}
          subtitle={editing !== "new" ? editing.slug : undefined}
          onClose={closeEditor}
          width={560}
        >
          <ResourceFormBody
            form={form}
            setForm={setForm}
            markDirty={markDirty}
            providers={providers}
            clients={clients}
            formErrors={formErrors}
            onKindRequest={requestKindSwitch}
            onAddScope={addScope}
            onRemoveScope={removeScope}
            onUpdateScope={updateScope}
            allowedClientToggle={toggleAllowedClient}
            onAskClearAllowlist={() => setConfirmingClearAllowlist(true)}
            runtimeClientToggle={toggleRuntimeClient}
            onAddReturnUrl={addReturnUrl}
            onRemoveReturnUrl={removeReturnUrl}
            onUpdateReturnUrl={updateReturnUrl}
            formClientName={formClientName}
            scopeCounts={scopeCounts}
          />

            {editing !== "new" && (
              <div
                style={{
                  marginTop: 24,
                  paddingTop: 16,
                  borderTop: `1px solid ${C.border}`,
                  display: "grid",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: sz.sm,
                    fontWeight: 500,
                    color: C.text,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {t("fronting")}
                </div>
                <ResourceFrontingSection
                  slug={editing.slug}
                  kind={editing.backend_kind}
                  scopes={editing.scopes}
                  onCreateLink={(slug) => {
                    window.location.hash = `#/fronting?new=1&source=${encodeURIComponent(slug)}`;
                  }}
                  onEditLink={(l) => {
                    window.location.hash = `#/fronting?openLink=${encodeURIComponent(l.source_slug)}/${encodeURIComponent(l.target_slug)}`;
                  }}
                  onScopeCountsChange={setScopeCounts}
                />
              </div>
            )}

          <div style={{ marginTop: 20 }}>
            <InfoBox color={C.blue}>
              {editing === "new"
                ? t("createInfo")
                : t("editInfo")}
            </InfoBox>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}`, justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 10 }}>
              <Btn secondary onClick={closeEditor}>{t("cancel")}</Btn>
              {editing === "new" ? (
                <Btn onClick={handleCreate}>{t("create")}</Btn>
              ) : (
                <Btn onClick={() => handlePatch(editing)} disabled={dirty.size === 0}>{t("saveChanges")}</Btn>
              )}
            </div>
            {editing !== "new" && (
              <Btn danger small onClick={() => { setDelTarget(editing); closeEditor(); }}>{t("delete")}</Btn>
            )}
          </div>
        </Drawer>
      )}

      {pendingKindSwitch && (
        <Modal
          title={t("switchKindTitle")}
          titleColor={C.warn}
          onClose={() => setPendingKindSwitch(null)}
        >
          <div style={{ fontSize: sz.base, color: C.textDim, lineHeight: 1.7, marginBottom: 14 }}>
            {t("switchKindBefore")} <strong style={{ color: C.text }}>{t("backendValue.broker")}</strong> {t("to")} <strong style={{ color: C.text }}>{t("backendValue.mint")}</strong>
            {" "}{t("switchKindAfter")}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn secondary small onClick={() => setPendingKindSwitch(null)}>{t("cancel")}</Btn>
            <Btn danger small onClick={() => applyKindSwitch(pendingKindSwitch)}>{t("switchAndClear")}</Btn>
          </div>
        </Modal>
      )}

      {confirmingClearAllowlist && (
        <Modal
          title={t("clearAllowlistTitle")}
          titleColor={C.danger}
          onClose={() => setConfirmingClearAllowlist(false)}
        >
          <div style={{ fontSize: sz.base, color: C.textDim, lineHeight: 1.7, marginBottom: 14 }}>
            {t("clearAllowlistBefore")} <strong style={{ color: C.danger }}>{t("any")}</strong> {t("clearAllowlistAfter")}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn secondary small onClick={() => setConfirmingClearAllowlist(false)}>{t("cancel")}</Btn>
            <Btn danger small onClick={clearAllowlist}>{t("clearAllowlist")}</Btn>
          </div>
        </Modal>
      )}

      {delTarget && (
        <Modal title={t("deleteTitle", { slug: delTarget.slug })} onClose={() => { setDelTarget(null); setDelInput(""); }}>
          <div style={{ fontSize: sz.base, color: C.textDim, lineHeight: 1.7, marginBottom: 14 }}>
            {t("deleteBefore")} <strong style={{ color: C.text }}>{delTarget.slug}</strong> {t("deleteAfter")}
          </div>
          <div style={{ fontSize: sz.sm, color: C.textDim, marginBottom: 6 }}>
            {t("typeToConfirmBefore")} <strong>{delTarget.slug}</strong> {t("typeToConfirmAfter")}
          </div>
          <TextInput value={delInput} onChange={setDelInput} placeholder={delTarget.slug} style={{ marginBottom: 14 }} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn secondary small onClick={() => { setDelTarget(null); setDelInput(""); }}>{t("cancel")}</Btn>
            <Btn danger small disabled={delInput !== delTarget.slug} onClick={handleDelete}>{t("delete")}</Btn>
          </div>
        </Modal>
      )}

      {cascadeModal && (
        <Modal
          title={t("cascadeDeleteTitle", { slug: cascadeModal.target.slug })}
          titleColor={C.danger}
          onClose={() => setCascadeModal(null)}
        >
          <div
            style={{
              fontSize: sz.base,
              color: C.textDim,
              lineHeight: 1.7,
              marginBottom: 14,
            }}
          >
            <strong style={{ color: C.text }}>
              {cascadeModal.target.slug}
            </strong>{" "}
            {t("stillHas")}{" "}
            <strong style={{ color: C.danger }}>
              {t("frontingLinks", { count: cascadeModal.dependents.length })}
            </strong>
            {t("cascadeDeleteAfter")}
          </div>
          <div
            style={{
              maxHeight: 180,
              overflowY: "auto",
              background: C.surface2,
              border: `1px solid ${C.border2}`,
              borderRadius: 6,
              padding: "6px 10px",
              marginBottom: 14,
              fontFamily: fonts.mono,
              fontSize: sz.sm,
              color: C.textDim,
            }}
          >
            {cascadeModal.dependents.slice(0, 10).map((l) => (
              <div key={`${l.source_slug}/${l.target_slug}`}>
                {l.source_slug} → {l.target_slug}
              </div>
            ))}
            {cascadeModal.dependents.length > 10 && (
              <div style={{ fontStyle: "italic", marginTop: 4 }}>
                {t("andMore", { count: cascadeModal.dependents.length - 10 })}
              </div>
            )}
          </div>
          <div style={{ fontSize: sz.sm, color: C.textDim, marginBottom: 6 }}>
            {t("typeToConfirmBefore")} <strong>{cascadeModal.target.slug}</strong> {t("typeToConfirmAfter")}
          </div>
          <TextInput
            value={cascadeModal.confirmInput}
            onChange={(v) =>
              setCascadeModal((m) => (m ? { ...m, confirmInput: v } : m))
            }
            placeholder={cascadeModal.target.slug}
            style={{ marginBottom: 14 }}
          />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn secondary small onClick={() => setCascadeModal(null)}>
              {t("cancel")}
            </Btn>
            <Btn
              danger
              small
              disabled={
                cascadeModal.confirmInput !== cascadeModal.target.slug
              }
              onClick={handleCascadeDelete}
            >
              {t("deleteWithCascade")}
            </Btn>
          </div>
        </Modal>
      )}

      <Toast message={toast?.msg ?? null} type={toast?.type} />
    </div>
  );
}

interface FormBodyProps {
  form: ResourceForm;
  setForm: React.Dispatch<React.SetStateAction<ResourceForm>>;
  markDirty: (f: DirtyField) => void;
  providers: BrokerProviderView[];
  clients: ClientView[];
  formErrors: Record<string, string>;
  onKindRequest: (k: BackendKind) => void;
  onAddScope: () => void;
  onRemoveScope: (i: number) => void;
  onUpdateScope: (i: number, field: keyof ScopeRow, value: string) => void;
  allowedClientToggle: (id: string) => void;
  onAskClearAllowlist: () => void;
  runtimeClientToggle: (id: string) => void;
  onAddReturnUrl: () => void;
  onRemoveReturnUrl: (i: number) => void;
  onUpdateReturnUrl: (i: number, value: string) => void;
  formClientName: (id: string) => string;
  scopeCounts: ScopePerLinkCounts;
}

function ResourceFormBody({
  form, setForm, markDirty, providers, clients, formErrors, onKindRequest,
  onAddScope, onRemoveScope, onUpdateScope, allowedClientToggle,
  onAskClearAllowlist, runtimeClientToggle,
  onAddReturnUrl, onRemoveReturnUrl, onUpdateReturnUrl,
  formClientName, scopeCounts,
}: FormBodyProps) {
  const { t } = useTranslation("resources");
  const isBroker = form.backend_kind === "broker";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <Label>{t("backendKindRequiredLabel")}</Label>
        <div style={{ display: "flex", gap: 6 }}>
          {(["mint", "broker"] as const).map((k) => (
            <button
              key={k}
              onClick={() => onKindRequest(k)}
              style={{
                padding: "6px 14px",
                borderRadius: 5,
                border: `1px solid ${form.backend_kind === k ? alpha(C.accent, 0x50) : C.border2}`,
                background: form.backend_kind === k ? alpha(C.accent, 0x18) : "transparent",
                color: form.backend_kind === k ? C.accent : C.textDim,
                cursor: "pointer",
                fontFamily: fonts.mono,
                fontSize: sz.sm,
                transition: "all 0.15s",
              }}
            >
              {t(`backendValue.${k}`)}
            </button>
          ))}
        </div>
        <div style={{ fontSize: sz.sm, color: C.textDim, marginTop: 4 }}>
          {isBroker
            ? t("brokerDescription")
            : t("mintDescription")}
        </div>
      </div>
      <div>
        <Label>{t("slugRequiredLabel")}</Label>
        <TextInput
          placeholder={t("slugExample")}
          value={form.slug}
          onChange={(v) => { setForm((f) => ({ ...f, slug: v })); markDirty("slug"); }}
        />
        {formErrors.slug && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{formErrors.slug}</div>}
      </div>
      <div>
        <Label>{t("displayNameRequiredLabel")}</Label>
        <TextInput
          placeholder={t("nameExample")}
          value={form.display_name}
          onChange={(v) => { setForm((f) => ({ ...f, display_name: v })); markDirty("display_name"); }}
        />
        {formErrors.display_name && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{formErrors.display_name}</div>}
      </div>
      <div>
        <Label>{t("uriRequiredLabel")}</Label>
        <TextInput
          placeholder={isBroker ? t("brokerUriExample") : t("mintUriExample")}
          value={form.uri}
          onChange={(v) => { setForm((f) => ({ ...f, uri: v })); markDirty("uri"); }}
        />
        {formErrors.uri && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{formErrors.uri}</div>}
        <div style={{ fontSize: sz.sm, color: C.textDim, marginTop: 4 }}>
          {isBroker
            ? t("brokerUriDescription")
            : t("mintUriDescription")}
        </div>
      </div>
      {isBroker && (
        <div>
          <Label>{t("providerRequiredLabel")}</Label>
          <select
            value={form.broker_provider_id}
            onChange={(e) => { setForm((f) => ({ ...f, broker_provider_id: e.target.value })); markDirty("broker_provider_id"); }}
            style={{
              width: "100%",
              background: C.surface2,
              border: `1px solid ${C.border2}`,
              borderRadius: 5,
              padding: "6px 10px",
              color: C.text,
              fontSize: sz.base,
              fontFamily: fonts.mono,
            }}
          >
            <option value="">{t("selectProvider")}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.slug} — {p.display_name} ({t(`protocolValue.${p.protocol}`, { defaultValue: p.protocol })})</option>
            ))}
          </select>
          {formErrors.broker_provider_id && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}>{formErrors.broker_provider_id}</div>}
          <div style={{ fontSize: sz.sm, color: C.textDim, marginTop: 4 }}>
            {t("providerHelp")}
          </div>
        </div>
      )}
      <div>
        <Label>{t("scopesRequiredLabel")}</Label>
        <div style={{ fontSize: sz.sm, color: C.textDim, marginBottom: 8 }}>
          {isBroker
            ? t("brokerScopesHelp")
            : t("mintScopesHelp")}
        </div>
        {form.scopes.map((row, i) => {
          const linksTouching = scopeCounts[row.name.trim()] ?? [];
          return (
            <div key={i} style={{ marginBottom: 8, display: "grid", gridTemplateColumns: isBroker ? "1fr 1fr 1fr auto 28px" : "1fr 2fr auto 28px", gap: 8, alignItems: "start" }}>
              <TextInput placeholder={t("scopeNamePlaceholder")} value={row.name} onChange={(v) => onUpdateScope(i, "name", v)} />
              {isBroker && (
                <TextInput placeholder={t("upstreamPlaceholder")} value={row.upstream} onChange={(v) => onUpdateScope(i, "upstream", v)} />
              )}
              <TextInput placeholder={t("descriptionPlaceholder")} value={row.description} onChange={(v) => onUpdateScope(i, "description", v)} />
              <ScopeFrontingBadge scopeName={row.name.trim()} links={linksTouching} />
              <Btn danger small onClick={() => onRemoveScope(i)}>{"✕"}</Btn>
            </div>
          );
        })}
        <div style={{ display: "flex" }}>
          <Btn secondary small full onClick={onAddScope}>{t("addScope")}</Btn>
        </div>
        {formErrors.scopes && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 6 }}>{formErrors.scopes}</div>}
      </div>
      <div>
        <Label>{t("allowlistLabel")}</Label>
        <div style={{ fontSize: sz.sm, color: C.textDim, marginBottom: 8 }}>
          {t("allowlistHelp")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {form.allowed_client_ids.map((id) => (
            <span
              key={id}
              onClick={() => allowedClientToggle(id)}
              style={{
                background: alpha(C.accent, 0x18),
                border: `1px solid ${alpha(C.accent, 0x40)}`,
                color: C.accent,
                borderRadius: 3,
                padding: "2px 8px",
                fontFamily: fonts.mono,
                fontSize: sz.sm,
                cursor: "pointer",
              }}
              title={t("clickToRemove")}
            >
              {formClientName(id)} <span style={{ color: C.textDim, marginLeft: 4 }}>{"✕"}</span>
            </span>
          ))}
          {form.allowed_client_ids.length === 0 && (
            <span style={{ fontSize: sz.sm, color: C.textDim, fontStyle: "italic" }}>
              {t("noAllowedClients")}
            </span>
          )}
        </div>
        <select
          value=""
          onChange={(e) => { if (e.target.value) allowedClientToggle(e.target.value); }}
          style={{
            background: C.surface2,
            border: `1px solid ${C.border2}`,
            borderRadius: 5,
            padding: "6px 10px",
            color: C.text,
            fontSize: sz.base,
            fontFamily: fonts.mono,
            marginRight: 8,
          }}
        >
          <option value="">{t("addClient")}</option>
          {clients.filter((c) => !form.allowed_client_ids.includes(c.id)).map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.id.substring(0, 8)}…)</option>
          ))}
        </select>
        {form.allowed_client_ids.length > 0 && (
          <Btn danger small onClick={onAskClearAllowlist}>{t("clearAllowlist")}</Btn>
        )}
      </div>
      <div>
        <Label>{t("runtimeClientsLabel")}</Label>
        <div style={{ fontSize: sz.sm, color: C.textDim, marginBottom: 8 }}>
          {t("runtimeClientsBefore")} <code>/oauth/token</code>{t("runtimeClientsAfter")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {form.runtime_client_ids.map((id) => (
            <span
              key={id}
              onClick={() => runtimeClientToggle(id)}
              style={{
                background: alpha(C.accent, 0x18),
                border: `1px solid ${alpha(C.accent, 0x40)}`,
                color: C.accent,
                borderRadius: 3,
                padding: "2px 8px",
                fontFamily: fonts.mono,
                fontSize: sz.sm,
                cursor: "pointer",
              }}
              title={t("clickToRemove")}
            >
              {formClientName(id)} <span style={{ color: C.textDim, marginLeft: 4 }}>{"✕"}</span>
            </span>
          ))}
          {form.runtime_client_ids.length === 0 && (
            <span style={{ fontSize: sz.sm, color: C.textDim, fontStyle: "italic" }}>
              {t("noRuntimeClients")}
            </span>
          )}
        </div>
        <select
          value=""
          onChange={(e) => { if (e.target.value) runtimeClientToggle(e.target.value); }}
          style={{
            background: C.surface2,
            border: `1px solid ${C.border2}`,
            borderRadius: 5,
            padding: "6px 10px",
            color: C.text,
            fontSize: sz.base,
            fontFamily: fonts.mono,
            marginRight: 8,
          }}
        >
          <option value="">{t("addClient")}</option>
          {clients.filter((c) => !form.runtime_client_ids.includes(c.id)).map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.id.substring(0, 8)}…)</option>
          ))}
        </select>
      </div>
      {isBroker && (
        <div>
          <Label>{t("returnUrlsLabel")}</Label>
          <div style={{ fontSize: sz.sm, color: C.textDim, marginBottom: 8 }}>
            {t("returnUrlsHelp")}
          </div>
          {form.allowed_return_urls.map((url, i) => (
            <div key={i} style={{ marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <TextInput placeholder="https://app.example.com/connect/return" value={url} onChange={(v) => onUpdateReturnUrl(i, v)} />
              </div>
              <Btn danger small onClick={() => onRemoveReturnUrl(i)}>{"✕"}</Btn>
            </div>
          ))}
          <div style={{ display: "flex" }}>
            <Btn secondary small full onClick={onAddReturnUrl}>{t("addReturnUrl")}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
