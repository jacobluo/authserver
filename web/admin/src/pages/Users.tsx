import { useState, useEffect, useCallback } from "react";
import type { FormEvent } from "react";
import { C, fonts, sz, alpha } from "../tokens";
import { listUsers, createUser, disableUser, enableUser, resetUserPassword } from "../api";
import type { UserView } from "../api";
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
import UserGrantsSection from "./users/UserGrantsSection";
import UserIssuancesSection from "./users/UserIssuancesSection";
import { useTranslation } from "../i18n";

function truncate(id: string): string {
  return id.length > 8 ? id.substring(0, 8) + "…" : id;
}

function formatDate(iso: string, locale: string): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

export default function Users() {
  const { t, i18n } = useTranslation("users");
  const [users, setUsers] = useState<UserView[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UserView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", name: "", password: "" });
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [passwordUser, setPasswordUser] = useState<UserView | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadUsers = useCallback(async () => {
    try {
      const data = await listUsers();
      setUsers(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filtered = users.filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return u.email.toLowerCase().includes(s) || u.name.toLowerCase().includes(s) || u.id.toLowerCase().includes(s);
  });

  const handleDisable = async (id: string) => {
    try {
      await disableUser(id);
      showToast(t("userDisabled"));
      setSelected(null);
      loadUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("failed"));
    }
  };

  const handleEnable = async (id: string) => {
    try {
      await enableUser(id);
      showToast(t("userEnabled"));
      setSelected(null);
      loadUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("failed"));
    }
  };

  const closeCreate = () => {
    if (creating) return;
    setShowCreate(false);
    setCreateForm({ email: "", name: "", password: "" });
    setCreateError("");
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;

    const email = createForm.email.trim();
    if (!email || !createForm.password) {
      setCreateError(t("emailPasswordRequired"));
      return;
    }

    setCreating(true);
    setCreateError("");
    try {
      await createUser({
        email,
        name: createForm.name.trim(),
        password: createForm.password,
        role: "user",
      });
      setShowCreate(false);
      setCreateForm({ email: "", name: "", password: "" });
      showToast(t("userCreated"));
      await loadUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const closePasswordReset = () => {
    if (resettingPassword) return;
    setPasswordUser(null);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
  };

  const handlePasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passwordUser || resettingPassword) return;
    const bytes = new TextEncoder().encode(newPassword).length;
    if (bytes < 8 || bytes > 72) {
      setPasswordError(t("passwordLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("passwordMismatch"));
      return;
    }
    setResettingPassword(true);
    setPasswordError("");
    try {
      await resetUserPassword(passwordUser.id, newPassword);
      setPasswordUser(null);
      setNewPassword("");
      setConfirmPassword("");
      showToast(t("passwordResetSuccess"));
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : t("passwordResetFailed"));
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 4 }}>
        <div style={{ fontFamily: fonts.mono, fontSize: sz.xl, fontWeight: 600 }}>{t("title")}</div>
        <Btn onClick={() => setShowCreate(true)}>{t("createUser")}</Btn>
      </div>
      <div style={{ fontSize: sz.base, color: C.textDim, marginBottom: 14 }}>
        {t("registeredUsers", { total: users.length })}
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: "8px 14px", background: alpha(C.danger, 0x12), border: `1px solid ${alpha(C.danger, 0x40)}`, borderRadius: 6, fontSize: sz.base, color: C.danger }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <TextInput placeholder={t("searchPlaceholder")} value={search} onChange={setSearch} style={{ width: 300 }} />
      </div>

      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: sz.base }}>
          <thead>
            <tr>
              {[t("id"), t("nameEmail"), t("auth"), t("role"), t("status"), t("created")].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: C.textDim, fontFamily: fonts.mono, fontSize: sz.xs, textTransform: "uppercase", letterSpacing: 1.2, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr
                key={u.id}
                onClick={() => setSelected(u)}
                style={{ cursor: "pointer", borderBottom: `1px solid ${C.border}`, transition: "background 0.1s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <td style={{ padding: "10px 12px" }}><Mono>{truncate(u.id)}</Mono></td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 500, fontSize: sz.base }}>{u.name || "\u2014"}</div>
                  <div style={{ fontSize: sz.sm, color: C.textDim, fontFamily: fonts.mono }}>{u.email}</div>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <Tag color={u.provider !== "local" && u.provider !== "" && u.provider !== "\u2014" ? C.blue : C.textDim}>
                    {u.provider !== "local" && u.provider !== "" && u.provider !== "\u2014" ? t("oidc") : t("local")}
                  </Tag>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <Tag color={u.role === "admin" ? C.accent : C.textDim}>{t(`roleValue.${u.role}`, { defaultValue: u.role })}</Tag>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <StatusDot status={u.status} />
                  <span style={{ fontSize: sz.base, color: C.textDim }}>{t(`statusValue.${u.status}`, { defaultValue: u.status })}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ fontSize: sz.base, color: C.textDim }}>{formatDate(u.created_at, i18n.language)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: "20px 12px", fontSize: sz.base, color: C.textDim, textAlign: "center" }}>
            {users.length === 0 ? t("noUsers") : t("noSearchResults")}
          </div>
        )}
      </Card>

      {selected && (
        <Drawer title={t("userDetail")} subtitle={selected.name || selected.email} onClose={() => setSelected(null)} width={620}>
          <DrawerRow label={t("userId")} value={<Mono style={{ fontSize: sz.sm }}>{selected.id}</Mono>} />
          <DrawerRow label={t("name")} value={selected.name || "\u2014"} />
          <DrawerRow label={t("email")} value={selected.email} />
          <DrawerRow label={t("role")} value={<Tag color={selected.role === "admin" ? C.accent : C.textDim}>{t(`roleValue.${selected.role}`, { defaultValue: selected.role })}</Tag>} />
          <DrawerRow label={t("status")} value={<><StatusDot status={selected.status} />{t(`statusValue.${selected.status}`, { defaultValue: selected.status })}</>} />
          <DrawerRow label={t("provider")} value={
            <Tag color={selected.provider !== "local" && selected.provider !== "" ? C.blue : C.textDim}>
              {selected.provider === "local" || !selected.provider ? t("local") : selected.provider}
            </Tag>
          } />
          <DrawerRow label={t("created")} value={formatDate(selected.created_at, i18n.language)} />

          <div style={{ marginTop: 20 }}>
            <SectionTitle>{t("actions")}</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selected.status === "active" ? (
                <Btn secondary small full onClick={() => handleDisable(selected.id)}>{t("disableUser")}</Btn>
              ) : (
                <Btn secondary small full onClick={() => handleEnable(selected.id)}>{t("enableUser")}</Btn>
              )}
              {selected.provider === "local" && (
                <Btn secondary small full onClick={() => setPasswordUser(selected)}>{t("resetPassword")}</Btn>
              )}
            </div>
          </div>

          <UserGrantsSection user={selected} />
          <UserIssuancesSection user={selected} />
        </Drawer>
      )}

      {showCreate && (
        <Modal title={t("createUser")} titleColor={C.accent} onClose={closeCreate}>
          <form onSubmit={handleCreate}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <label>
                <Label>{t("emailRequired")}</Label>
                <TextInput type="email" placeholder={t("emailPlaceholder")} value={createForm.email} onChange={(email) => setCreateForm((form) => ({ ...form, email }))} />
              </label>
              <label>
                <Label>{t("name")}</Label>
                <TextInput placeholder={t("displayNamePlaceholder")} value={createForm.name} onChange={(name) => setCreateForm((form) => ({ ...form, name }))} />
              </label>
              <label>
                <Label>{t("passwordRequired")}</Label>
                <TextInput type="password" placeholder={t("initialPasswordPlaceholder")} value={createForm.password} onChange={(password) => setCreateForm((form) => ({ ...form, password }))} />
              </label>
              <div style={{ fontSize: sz.sm, color: C.textDim }}>{t("defaultRole")}</div>
              {createError && <div role="alert" style={{ fontSize: sz.sm, color: C.danger }}>{createError}</div>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
              <Btn secondary onClick={closeCreate} disabled={creating}>{t("cancel")}</Btn>
              <Btn type="submit" disabled={creating}>{creating ? t("creating") : t("createUser")}</Btn>
            </div>
          </form>
        </Modal>
      )}

      {passwordUser && (
        <Modal title={t("resetPassword")} titleColor={C.accent} onClose={closePasswordReset}>
          <form onSubmit={handlePasswordReset}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: sz.base, color: C.textDim }}>{passwordUser.email}</div>
              <label>
                <Label>{t("newPassword")}</Label>
                <TextInput type="password" value={newPassword} onChange={setNewPassword} />
              </label>
              <label>
                <Label>{t("confirmPassword")}</Label>
                <TextInput type="password" value={confirmPassword} onChange={setConfirmPassword} />
              </label>
              <div style={{ fontSize: sz.sm, color: C.textDim }}>{t("passwordResetNotice")}</div>
              {passwordError && <div role="alert" style={{ fontSize: sz.sm, color: C.danger }}>{passwordError}</div>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
              <Btn secondary onClick={closePasswordReset} disabled={resettingPassword}>{t("cancel")}</Btn>
              <Btn type="submit" disabled={resettingPassword}>{resettingPassword ? t("resettingPassword") : t("resetPassword")}</Btn>
            </div>
          </form>
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  );
}
