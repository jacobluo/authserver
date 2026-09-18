// FrontingLinkDrawer — create/edit drawer for fronting links.
//
// mode="create": source/target editable; ScopeMapEditor populated from the
// chosen Resources' scopes.
// mode="edit":   source/target read-only; only scope_map editable.
// Validate button posts ?dry_run=true; Save commits. Validate is not a
// precondition for Save (operator may skip; the backend re-validates).

import { useEffect, useMemo, useState } from "react";
import { C, fonts, sz, alpha } from "../tokens";
import {
  createFrontingLink,
  patchFrontingLink,
  previewFrontingLink,
  deleteFrontingLink,
} from "../api";
import type {
  FrontingLinkView,
  ResourceView,
  ScopeMap,
} from "../api";
import Btn from "./Btn";
import Drawer from "./Drawer";
import InfoBox from "./InfoBox";
import Label from "./Label";
import Modal from "./Modal";
import Mono from "./Mono";
import Tag from "./Tag";
import TextInput from "./TextInput";
import ScopeMapEditor from "./ScopeMapEditor";
import { useTranslation } from "../i18n";

interface FrontingLinkDrawerProps {
  mode: "create" | "edit";
  link?: FrontingLinkView; // required when mode === "edit"
  resources: ResourceView[];
  // When mode === "create", the caller can preselect source/target
  // (used by ResourceFrontingSection's empty-state shortcut).
  initialSource?: string;
  initialTarget?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface FormErrors {
  source?: string;
  target?: string;
  scope_map?: string;
}

export default function FrontingLinkDrawer({
  mode,
  link,
  resources,
  initialSource,
  initialTarget,
  onClose,
  onSaved,
}: FrontingLinkDrawerProps) {
  const { t } = useTranslation("fronting");
  const [source, setSource] = useState(
    mode === "edit" ? link!.source_slug : initialSource ?? "",
  );
  const [target, setTarget] = useState(
    mode === "edit" ? link!.target_slug : initialTarget ?? "",
  );
  const [scopeMap, setScopeMap] = useState<ScopeMap>(() =>
    mode === "edit" ? cloneMap(link!.scope_map) : {},
  );

  const [validateState, setValidateState] = useState<
    | { kind: "idle" }
    | { kind: "ok" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [delInput, setDelInput] = useState("");
  const [scopeMapDirty, setScopeMapDirty] = useState(false);

  const sourceResource = useMemo(
    () => resources.find((r) => r.slug === source),
    [resources, source],
  );
  const targetResource = useMemo(
    () => resources.find((r) => r.slug === target),
    [resources, target],
  );

  // Reset validation status whenever the form changes.
  useEffect(() => {
    setValidateState({ kind: "idle" });
  }, [source, target, scopeMap]);

  const mintResources = resources.filter((r) => r.backend_kind === "mint");

  // In create mode, changing source or target invalidates any existing
  // scope_map entries (their keys/values reference the previous resource's
  // scopes). Clear the map silently — preserving entries would render
  // them as stale yellow tags, which is the intended UX for edit mode
  // (operator-visible drift) but only confusing during the initial build.
  const handleSourcePick = (next: string) => {
    if (mode === "create" && next !== source && Object.keys(scopeMap).length > 0) {
      setScopeMap({});
      setScopeMapDirty(false);
    }
    setSource(next);
  };
  const handleTargetPick = (next: string) => {
    if (mode === "create" && next !== target && Object.keys(scopeMap).length > 0) {
      setScopeMap({});
      setScopeMapDirty(false);
    }
    setTarget(next);
  };

  const validateClient = (): FormErrors => {
    const e: FormErrors = {};
    if (!source) e.source = t("sourceRequired");
    if (!target) e.target = t("targetRequired");
    if (source && target && source === target) {
      e.target = t("differentResources");
    }
    if (Object.keys(scopeMap).length === 0) {
      e.scope_map = t("mappingRequired");
    } else {
      for (const [k, v] of Object.entries(scopeMap)) {
        if (v.length === 0) {
          e.scope_map = t("mappingTargetRequired", { scope: k });
          break;
        }
      }
    }
    return e;
  };

  const handleValidate = async () => {
    const e = validateClient();
    setFormErrors(e);
    if (Object.keys(e).length > 0) return;
    setValidating(true);
    try {
      await previewFrontingLink({ source, target, scope_map: scopeMap });
      setValidateState({ kind: "ok" });
    } catch (err) {
      setValidateState({
        kind: "error",
        message: err instanceof Error ? err.message : t("validationFailed"),
      });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    const e = validateClient();
    setFormErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    try {
      if (mode === "create") {
        await createFrontingLink({ source, target, scope_map: scopeMap });
      } else {
        await patchFrontingLink(link!.source_slug, link!.target_slug, {
          scope_map: scopeMap,
        });
      }
      onSaved();
    } catch (err) {
      setValidateState({
        kind: "error",
        message: err instanceof Error ? err.message : t("saveFailed"),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!link) return;
    try {
      await deleteFrontingLink(link.source_slug, link.target_slug);
      onSaved();
    } catch (err) {
      setValidateState({
        kind: "error",
        message: err instanceof Error ? err.message : t("deleteFailed"),
      });
      setConfirmingDelete(false);
    }
  };

  const saveDisabled =
    saving ||
    (mode === "edit" && !scopeMapDirty);

  const deleteConfirmKey = link
    ? `${link.source_slug}/${link.target_slug}`
    : "";

  return (
    <>
      <Drawer
        title={
          mode === "create" ? t("newDrawer") : t("editDrawer")
        }
        subtitle={
          mode === "edit"
            ? `${link!.source_slug} → ${link!.target_slug}`
            : undefined
        }
        onClose={onClose}
        width={620}
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <Label>{t("sourceLabel")}</Label>
            {mode === "edit" ? (
              <div
                title={t("sourceReadOnlyTitle")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  background: C.surface2,
                  border: `1px solid ${C.border2}`,
                  borderRadius: 5,
                  cursor: "default",
                }}
              >
                <Mono>{source}</Mono>
                {sourceResource && (
                  <span style={{ color: C.textDim, fontSize: sz.sm }}>
                    {sourceResource.display_name}
                  </span>
                )}
                <Tag color={C.textDim}>{t("readOnly")}</Tag>
              </div>
            ) : (
              <select
                value={source}
                onChange={(e) => handleSourcePick(e.target.value)}
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
                <option value="">{t("selectMint")}</option>
                {mintResources.map((r) => (
                  <option key={r.id} value={r.slug}>
                    {r.slug} — {r.display_name}
                  </option>
                ))}
              </select>
            )}
            {formErrors.source && (
              <div
                style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}
              >
                {formErrors.source}
              </div>
            )}
          </div>

          <div>
            <Label>{t("targetLabel")}</Label>
            {mode === "edit" ? (
              <div
                title={t("targetReadOnlyTitle")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  background: C.surface2,
                  border: `1px solid ${C.border2}`,
                  borderRadius: 5,
                  cursor: "default",
                }}
              >
                <Mono>{target}</Mono>
                {targetResource && (
                  <Tag
                    color={
                      targetResource.backend_kind === "mint"
                        ? C.blue
                        : C.purple
                    }
                  >
                    {targetResource.backend_kind}
                  </Tag>
                )}
                {targetResource && (
                  <span style={{ color: C.textDim, fontSize: sz.sm }}>
                    {targetResource.display_name}
                  </span>
                )}
                <Tag color={C.textDim}>{t("readOnly")}</Tag>
              </div>
            ) : (
              <select
                value={target}
                onChange={(e) => handleTargetPick(e.target.value)}
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
                <option value="">{t("selectTargetResource")}</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.slug}>
                    {r.slug} ({r.backend_kind}) — {r.display_name}
                  </option>
                ))}
              </select>
            )}
            {formErrors.target && (
              <div
                style={{ fontSize: sz.sm, color: C.danger, marginTop: 3 }}
              >
                {formErrors.target}
              </div>
            )}
          </div>

          <div>
            <Label>{t("scopeMapLabel")}</Label>
            <div
              style={{ fontSize: sz.sm, color: C.textDim, marginBottom: 8 }}
            >
              {t("scopeMapHelp")}
            </div>
            <ScopeMapEditor
              sourceScopes={
                sourceResource?.scopes.map((s) => s.name) ?? []
              }
              targetScopes={
                targetResource?.scopes.map((s) => s.name) ?? []
              }
              value={scopeMap}
              onChange={(next) => {
                setScopeMap(next);
                setScopeMapDirty(true);
              }}
            />
            {formErrors.scope_map && (
              <div style={{ fontSize: sz.sm, color: C.danger, marginTop: 6 }}>
                {formErrors.scope_map}
              </div>
            )}
          </div>

          {validateState.kind === "ok" && (
            <div
              style={{
                padding: "8px 12px",
                background: alpha(C.success, 0x18),
                border: `1px solid ${alpha(C.success, 0x40)}`,
                borderRadius: 6,
                color: C.success,
                fontSize: sz.sm,
              }}
            >
              {t("validationOk")}
            </div>
          )}
          {validateState.kind === "error" && (
            <div
              style={{
                padding: "8px 12px",
                background: alpha(C.danger, 0x12),
                border: `1px solid ${alpha(C.danger, 0x40)}`,
                borderRadius: 6,
                color: C.danger,
                fontSize: sz.sm,
              }}
            >
              {validateState.message}
            </div>
          )}

          <InfoBox color={C.blue}>
            {t("linkHelp")}
            <br />
            {t("validationHelp")}
          </InfoBox>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 20,
            paddingTop: 16,
            borderTop: `1px solid ${C.border}`,
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <Btn secondary onClick={onClose}>
              {t("cancel")}
            </Btn>
            <Btn secondary onClick={handleValidate} disabled={validating}>
              {validating ? t("validating") : t("validate")}
            </Btn>
            <Btn onClick={handleSave} disabled={saveDisabled}>
              {saving ? t("saving") : t("save")}
            </Btn>
          </div>
          {mode === "edit" && (
            <Btn danger small onClick={() => setConfirmingDelete(true)}>
              {t("delete")}
            </Btn>
          )}
        </div>
      </Drawer>

      {confirmingDelete && link && (
        <Modal
          title={t("deleteTitle", { source: link.source_slug, target: link.target_slug })}
          onClose={() => {
            setConfirmingDelete(false);
            setDelInput("");
          }}
        >
          <div
            style={{
              fontSize: sz.base,
              color: C.textDim,
              lineHeight: 1.7,
              marginBottom: 14,
            }}
          >
            {t("deleteHelp")}
          </div>
          <div style={{ fontSize: sz.sm, color: C.textDim, marginBottom: 6 }}>
            {t("deleteConfirm", { key: deleteConfirmKey })}
          </div>
          <TextInput
            value={delInput}
            onChange={setDelInput}
            placeholder={deleteConfirmKey}
            style={{ marginBottom: 14 }}
          />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn
              secondary
              small
              onClick={() => {
                setConfirmingDelete(false);
                setDelInput("");
              }}
            >
              {t("cancel")}
            </Btn>
            <Btn
              danger
              small
              disabled={delInput !== deleteConfirmKey}
              onClick={handleDelete}
            >
              {t("delete")}
            </Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

function cloneMap(m: ScopeMap): ScopeMap {
  const out: ScopeMap = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = [...v];
  }
  return out;
}
