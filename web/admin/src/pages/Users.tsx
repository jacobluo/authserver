import { useState, useEffect, useCallback } from "react";
import type { FormEvent } from "react";
import { C, fonts, sz, alpha } from "../tokens";
import { listUsers, createUser, disableUser, enableUser } from "../api";
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

function truncate(id: string): string {
  return id.length > 8 ? id.substring(0, 8) + "…" : id;
}

function formatDate(iso: string): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Users() {
  const [users, setUsers] = useState<UserView[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UserView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", name: "", password: "" });
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

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
      setError(err instanceof Error ? err.message : "Failed to load users");
    }
  }, []);

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
      showToast("User disabled");
      setSelected(null);
      loadUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleEnable = async (id: string) => {
    try {
      await enableUser(id);
      showToast("User enabled");
      setSelected(null);
      loadUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed");
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
      setCreateError("Email and password are required.");
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
      showToast("User created");
      await loadUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 4 }}>
        <div style={{ fontFamily: fonts.mono, fontSize: sz.xl, fontWeight: 600 }}>Users</div>
        <Btn onClick={() => setShowCreate(true)}>Create User</Btn>
      </div>
      <div style={{ fontSize: sz.base, color: C.textDim, marginBottom: 14 }}>
        {users.length} registered users
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: "8px 14px", background: alpha(C.danger, 0x12), border: `1px solid ${alpha(C.danger, 0x40)}`, borderRadius: 6, fontSize: sz.base, color: C.danger }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <TextInput placeholder="Search by name, email, or ID…" value={search} onChange={setSearch} style={{ width: 300 }} />
      </div>

      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: sz.base }}>
          <thead>
            <tr>
              {["ID", "Name / Email", "Auth", "Role", "Status", "Created"].map((h) => (
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
                    {u.provider !== "local" && u.provider !== "" && u.provider !== "\u2014" ? "oidc" : "local"}
                  </Tag>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <Tag color={u.role === "admin" ? C.accent : C.textDim}>{u.role}</Tag>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <StatusDot status={u.status} />
                  <span style={{ fontSize: sz.base, color: C.textDim }}>{u.status}</span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ fontSize: sz.base, color: C.textDim }}>{formatDate(u.created_at)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: "20px 12px", fontSize: sz.base, color: C.textDim, textAlign: "center" }}>
            {users.length === 0 ? "No users registered." : "No users match your search."}
          </div>
        )}
      </Card>

      {selected && (
        <Drawer title="User Detail" subtitle={selected.name || selected.email} onClose={() => setSelected(null)} width={620}>
          <DrawerRow label="user_id" value={<Mono style={{ fontSize: sz.sm }}>{selected.id}</Mono>} />
          <DrawerRow label="name" value={selected.name || "\u2014"} />
          <DrawerRow label="email" value={selected.email} />
          <DrawerRow label="role" value={<Tag color={selected.role === "admin" ? C.accent : C.textDim}>{selected.role}</Tag>} />
          <DrawerRow label="status" value={<><StatusDot status={selected.status} />{selected.status}</>} />
          <DrawerRow label="provider" value={
            <Tag color={selected.provider !== "local" && selected.provider !== "" ? C.blue : C.textDim}>
              {selected.provider || "local"}
            </Tag>
          } />
          <DrawerRow label="created" value={formatDate(selected.created_at)} />

          <div style={{ marginTop: 20 }}>
            <SectionTitle>Actions</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selected.status === "active" ? (
                <Btn secondary small full onClick={() => handleDisable(selected.id)}>Disable User</Btn>
              ) : (
                <Btn secondary small full onClick={() => handleEnable(selected.id)}>Enable User</Btn>
              )}
            </div>
          </div>

          <UserGrantsSection user={selected} />
          <UserIssuancesSection user={selected} />
        </Drawer>
      )}

      {showCreate && (
        <Modal title="Create User" titleColor={C.accent} onClose={closeCreate}>
          <form onSubmit={handleCreate}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <label>
                <Label>Email *</Label>
                <TextInput type="email" placeholder="user@example.com" value={createForm.email} onChange={(email) => setCreateForm((form) => ({ ...form, email }))} />
              </label>
              <label>
                <Label>Name</Label>
                <TextInput placeholder="Display name (optional)" value={createForm.name} onChange={(name) => setCreateForm((form) => ({ ...form, name }))} />
              </label>
              <label>
                <Label>Password *</Label>
                <TextInput type="password" placeholder="Initial password" value={createForm.password} onChange={(password) => setCreateForm((form) => ({ ...form, password }))} />
              </label>
              <div style={{ fontSize: sz.sm, color: C.textDim }}>Role: user</div>
              {createError && <div role="alert" style={{ fontSize: sz.sm, color: C.danger }}>{createError}</div>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
              <Btn secondary onClick={closeCreate} disabled={creating}>Cancel</Btn>
              <Btn type="submit" disabled={creating}>{creating ? "Creating..." : "Create User"}</Btn>
            </div>
          </form>
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  );
}
