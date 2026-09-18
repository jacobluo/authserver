// Providers.tsx — admin surface for BrokerProviders.
//
// A BrokerProvider is the upstream-config row a Broker Resource references
// (e.g. "github" — the OAuth client_id, token URL, response format the
// adapter uses). config_data is adapter-shaped opaque JSON; the UI does
// not validate beyond JSON well-formedness — the server validates per
// protocol at create / patch time.

import { useState, useEffect, useCallback } from "react";
import { C, fonts, sz, alpha } from "../tokens";
import {
  listBrokerProviders, createBrokerProvider, patchBrokerProvider, deleteBrokerProvider,
} from "../api";
import type {
  BrokerProviderView, BrokerProviderPatch, Protocol, CreateBrokerProviderRequest,
} from "../api";
import Btn from "../components/Btn";
import Card from "../components/Card";
import Label from "../components/Label";
import Mono from "../components/Mono";
import Tag from "../components/Tag";
import TextInput from "../components/TextInput";
import Drawer from "../components/Drawer";
import DrawerRow from "../components/DrawerRow";
import Modal from "../components/Modal";
import Toast from "../components/Toast";
import InfoBox from "../components/InfoBox";
import SectionTitle from "../components/SectionTitle";
import JsonView from "../components/JsonView";
import { useTranslation } from "../i18n";

const PROTOCOL_OPTIONS: Protocol[] = ["oauth", "api_key", "service_account"];

const PROTOCOL_SAMPLES: Record<Protocol, unknown> = {
  oauth: {
    client_id: "your-oauth-client-id",
    client_secret_ref: "CONNECTOR_GITHUB_CLIENT_SECRET",
    authorize_url: "https://github.com/login/oauth/authorize",
    token_url: "https://github.com/login/oauth/access_token",
    response_format: "standard",
  },
  api_key: {
    header_name: "Authorization",
    header_prefix: "Bearer",
    issuance_instructions_url: "https://linear.app/settings/api",
  },
  service_account: {
    token_url: "https://oauth2.googleapis.com/token",
    sa_email: "svc@your-project.iam.gserviceaccount.com",
    sa_key_ref: "CONNECTOR_GCP_SA_KEY",
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  },
};

interface ProviderForm {
  slug: string;
  display_name: string;
  protocol: Protocol;
  config_text: string;
}

const emptyForm: ProviderForm = {
  slug: "",
  display_name: "",
  protocol: "oauth",
  config_text: "",
};

const formFromView = (p: BrokerProviderView): ProviderForm => ({
  slug: p.slug,
  display_name: p.display_name,
  protocol: p.protocol,
  config_text: JSON.stringify(p.config_data ?? {}, null, 2),
});

type DirtyField = "slug" | "display_name" | "protocol" | "config_data";

export default function Providers() {
  const { t } = useTranslation("providers");
  const [providers, setProviders] = useState<BrokerProviderView[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const [editing, setEditing] = useState<BrokerProviderView | "new" | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [initialForm, setInitialForm] = useState<ProviderForm>(emptyForm);
  const [dirty, setDirty] = useState<Set<DirtyField>>(new Set());
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [showSample, setShowSample] = useState<Protocol | null>(null);

  const [delTarget, setDelTarget] = useState<BrokerProviderView | null>(null);
  const [delInput, setDelInput] = useState("");

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const markDirty = (f: DirtyField) => {
    setDirty((d) => {
      if (d.has(f)) return d;
      const next = new Set(d);
      next.add(f);
      return next;
    });
  };

  const load = useCallback(async () => {
    try {
      const ps = await listBrokerProviders();
      setProviders(ps);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const filtered = providers.filter((p) => {
    if (!search) return true;
    const t = search.toLowerCase();
    return (
      p.slug.toLowerCase().includes(t) ||
      p.display_name.toLowerCase().includes(t) ||
      p.protocol.toLowerCase().includes(t)
    );
  });

  const openCreate = () => {
    setForm({ ...emptyForm, config_text: JSON.stringify(PROTOCOL_SAMPLES.oauth, null, 2) });
    setInitialForm(emptyForm);
    setDirty(new Set());
    setFormErrors({});
    setEditing("new");
  };

  const openEdit = (p: BrokerProviderView) => {
    const f = formFromView(p);
    setForm(f);
    setInitialForm(f);
    setDirty(new Set());
    setFormErrors({});
    setEditing(p);
  };

  const closeEditor = () => {
    setEditing(null);
    setDirty(new Set());
    setFormErrors({});
    setShowSample(null);
  };

  const parseConfig = (raw: string): { ok: true; value: unknown } | { ok: false; err: string } => {
    if (raw.trim() === "") return { ok: false, err: t("configRequired") };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? e.message : t("invalidJson") };
    }
  };

  const validate = (): { ok: false } | { ok: true; config: unknown } => {
    const e: Record<string, string> = {};
    if (!form.slug.trim()) e.slug = t("slugRequired");
    if (!form.display_name.trim()) e.display_name = t("nameRequired");
    const parsed = parseConfig(form.config_text);
    if (!parsed.ok) e.config_data = t("jsonParseError", { error: parsed.err });
    setFormErrors(e);
    if (Object.keys(e).length > 0) return { ok: false };
    return { ok: true, config: (parsed as { ok: true; value: unknown }).value };
  };

  const handleCreate = async () => {
    const v = validate();
    if (!v.ok) return;
    const req: CreateBrokerProviderRequest = {
      slug: form.slug.trim(),
      display_name: form.display_name.trim(),
      protocol: form.protocol,
      config_data: v.config,
    };
    try {
      await createBrokerProvider(req);
      showToast(t("created", { slug: req.slug }));
      closeEditor();
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("createFailed"), "error");
    }
  };

  const handlePatch = async (target: BrokerProviderView) => {
    const v = validate();
    if (!v.ok) return;
    const patch: BrokerProviderPatch = {};
    if (dirty.has("slug") && form.slug.trim() !== initialForm.slug) patch.slug = form.slug.trim();
    if (dirty.has("display_name") && form.display_name.trim() !== initialForm.display_name) {
      patch.display_name = form.display_name.trim();
    }
    if (dirty.has("protocol") && form.protocol !== initialForm.protocol) patch.protocol = form.protocol;
    if (dirty.has("config_data") && form.config_text.trim() !== initialForm.config_text.trim()) {
      patch.config_data = v.config;
    }
    if (Object.keys(patch).length === 0) {
      showToast(t("noChanges"));
      return;
    }
    try {
      await patchBrokerProvider(target.id, patch);
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
      await deleteBrokerProvider(delTarget.id);
      showToast(t("deleted"));
      setDelTarget(null);
      setDelInput("");
      load();
    } catch (err) {
      // 409 if a Resource still references this provider — surface verbatim.
      showToast(err instanceof Error ? err.message : t("deleteFailed"), "error");
    }
  };

  const protocolColor = (p: Protocol): string => {
    if (p === "oauth") return C.purple;
    if (p === "api_key") return C.blue;
    return C.success;
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
        <div style={{ width: 280 }}>
          <TextInput placeholder={t("searchPlaceholder")} value={search} onChange={setSearch} />
        </div>
        <Btn onClick={openCreate}>{t("newProvider")}</Btn>
      </div>

      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: sz.base }}>
          <thead>
            <tr>
              {[t("slug"), t("displayName"), t("protocol"), t("updatedColumn")].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: C.textDim, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1.2, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                onClick={() => openEdit(p)}
                style={{ cursor: "pointer", borderBottom: `1px solid ${C.border}`, transition: "background 0.1s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <td style={{ padding: "10px 12px", fontWeight: 500 }}>{p.slug}</td>
                <td style={{ padding: "10px 12px" }}>{p.display_name || <span style={{ color: C.textDim }}>{"—"}</span>}</td>
                <td style={{ padding: "10px 12px" }}><Tag color={protocolColor(p.protocol)}>{t(`protocolValue.${p.protocol}`, { defaultValue: p.protocol })}</Tag></td>
                <td style={{ padding: "10px 12px", color: C.textDim, fontSize: sz.sm }}>
                  {new Date(p.updated_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: "20px 12px", fontSize: sz.base, color: C.textDim, textAlign: "center" }}>
            {providers.length === 0
              ? t("empty")
              : t("noMatches")}
          </div>
        )}
      </Card>

      {editing && (
        <Drawer
          title={editing === "new" ? t("newProviderTitle") : t("editProviderTitle")}
          subtitle={editing !== "new" ? editing.slug : undefined}
          onClose={closeEditor}
          width={560}
        >
          <div style={{ display: "grid", gap: 16 }}>
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
              <Label>{t("protocolRequiredLabel")}</Label>
              <div style={{ display: "flex", gap: 6 }}>
                {PROTOCOL_OPTIONS.map((p) => (
                  <button
                    key={p}
                    onClick={() => { setForm((f) => ({ ...f, protocol: p })); markDirty("protocol"); }}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 5,
                      border: `1px solid ${form.protocol === p ? alpha(C.accent, 0x50) : C.border2}`,
                      background: form.protocol === p ? alpha(C.accent, 0x18) : "transparent",
                      color: form.protocol === p ? C.accent : C.textDim,
                      cursor: "pointer",
                      fontFamily: fonts.mono,
                      fontSize: sz.sm,
                      transition: "all 0.15s",
                    }}
                  >
                    {t(`protocolValue.${p}`, { defaultValue: p })}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>{t("configDataRequiredLabel")}</Label>
              <div style={{ fontSize: sz.sm, color: C.textDim, marginBottom: 6 }}>
                {t("configDescription")}
              </div>
              <TextInput
                rows={12}
                placeholder={'{\n  "client_id": "…"\n}'}
                value={form.config_text}
                onChange={(v) => { setForm((f) => ({ ...f, config_text: v })); markDirty("config_data"); }}
              />
              {formErrors.config_data && <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 4 }}>{formErrors.config_data}</div>}
              <div style={{ marginTop: 6 }}>
                <button
                  onClick={() => setShowSample(form.protocol)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: C.blue,
                    cursor: "pointer",
                    fontFamily: fonts.mono,
                    fontSize: sz.sm,
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  {t("seeSample", { protocol: t(`protocolValue.${form.protocol}`, { defaultValue: form.protocol }) })}
                </button>
              </div>
            </div>
            {editing !== "new" && (
              <>
                <div style={{ marginTop: 6 }}>
                  <SectionTitle>{t("metadata")}</SectionTitle>
                  <DrawerRow label="provider_id" value={<Mono style={{ fontSize: sz.sm }}>{editing.id}</Mono>} />
                  <DrawerRow label={t("createdColumn")} value={new Date(editing.created_at).toLocaleString()} />
                  <DrawerRow label={t("updatedColumn")} value={new Date(editing.updated_at).toLocaleString()} />
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <InfoBox color={C.blue}>
              {t("secretsBefore")} <Mono>config_data</Mono>{t("secretsMiddle")} <Mono>client_secret_ref</Mono>{t("secretsAfter")}
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

      {showSample && (
        <Modal
          title={t("sampleTitle", { protocol: showSample })}
          titleColor={C.blue}
          width={560}
          onClose={() => setShowSample(null)}
        >
          <div style={{ fontSize: sz.sm, color: C.textDim, lineHeight: 1.7, marginBottom: 10 }}>
            {t("sampleDescription")}
          </div>
          <JsonView value={PROTOCOL_SAMPLES[showSample]} />
          <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
            <Btn secondary small onClick={() => setShowSample(null)}>{t("close")}</Btn>
            <Btn small onClick={() => {
              setForm((f) => ({ ...f, config_text: JSON.stringify(PROTOCOL_SAMPLES[showSample], null, 2) }));
              markDirty("config_data");
              setShowSample(null);
            }}>{t("useSample")}</Btn>
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

      <Toast message={toast?.msg ?? null} type={toast?.type} />
    </div>
  );
}
