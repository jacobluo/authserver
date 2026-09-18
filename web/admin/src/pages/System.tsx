import { useState, useEffect } from "react";
import { C, fonts, sz } from "../tokens";
import { getSystemStatus, getSystemConfig } from "../api";
import type { SystemStatusResponse, SystemConfigResponse } from "../api";
import Card from "../components/Card";
import SectionTitle from "../components/SectionTitle";
import Label from "../components/Label";
import StatusDot from "../components/StatusDot";
import Tag from "../components/Tag";
import Mono from "../components/Mono";
import InfoBox from "../components/InfoBox";
import { useTranslation } from "../i18n";

function subsystemStatus(status: SystemStatusResponse | null, name: string): { status: string; driver?: string } {
  const sub = status?.subsystems.find(s => s.name === name);
  return { status: sub?.status || "unknown", driver: sub?.driver };
}

export default function System() {
  const { t } = useTranslation("system");
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [config, setConfig] = useState<SystemConfigResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getSystemStatus(), getSystemConfig()])
      .then(([s, c]) => { setStatus(s); setConfig(c); })
      .catch(err => setError(err instanceof Error ? err.message : t("loadFailed")));
  }, [t]);

  const storage = subsystemStatus(status, "storage");
  const encryption = subsystemStatus(status, "encryption");

  return (
    <div style={{ padding: 28 }}>
      <div style={{ fontSize: sz.xl, fontWeight: 600, fontFamily: fonts.mono, marginBottom: 4 }}>{t("title")}</div>
      <div style={{ fontSize: sz.base, color: C.textDim, marginBottom: 24 }}>
        {t("subtitle")}
      </div>

      {error && <div style={{ marginBottom: 14 }}><InfoBox color={C.danger}>{error}</InfoBox></div>}

      {/* Health cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        <Card>
          <Label>Authplane</Label>
          <div style={{ fontFamily: fonts.mono, fontSize: sz.lg, color: C.accent, marginBottom: 4 }}>
            v{status?.version || "—"}
          </div>
          <div style={{ fontSize: sz.base, color: C.textDim }}>
            {t("up")} {status?.uptime || "—"}
          </div>
        </Card>

        <Card>
          <Label>{t("storage")}</Label>
          <div style={{ fontFamily: fonts.mono, fontSize: sz.base, color: C.text, marginBottom: 4 }}>
            {config?.storage.driver || storage.driver || "—"}
          </div>
          <div style={{ fontSize: sz.base }}>
            <StatusDot status={storage.status} />
            {t(`status.${storage.status}`, { defaultValue: storage.status })}
          </div>
        </Card>

        <Card>
          <Label>{t("encryption")}</Label>
          <div style={{ fontFamily: fonts.mono, fontSize: sz.base, color: C.text, marginBottom: 4 }}>
            {config?.encryption.driver || encryption.driver || "—"}
          </div>
          <div style={{ fontSize: sz.base }}>
            <StatusDot status={encryption.status} />
            {t(`status.${encryption.status}`, { defaultValue: encryption.status })}
          </div>
        </Card>

        <Card>
          <Label>{t("rateLimiting")}</Label>
          <div style={{ fontFamily: fonts.mono, fontSize: sz.base, color: C.text, marginBottom: 4 }}>
            {config?.rate_limit.enabled ? t("enabled") : t("disabled")}
          </div>
          <div style={{ fontSize: sz.base }}>
            <StatusDot status={config?.rate_limit.enabled ? "active" : "disabled"} />
            {config?.rate_limit.enabled ? t("active") : t("off")}
          </div>
        </Card>
      </div>

      {/* Server Info */}
      {config && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SectionTitle>{t("serverConfiguration")}</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              <div>
                <Label>{t("issuer")}</Label>
                <Mono style={{ fontSize: sz.sm, wordBreak: "break-all" }}>{config.issuer}</Mono>
              </div>
              <div>
                <Label>{t("signingAlgorithm")}</Label>
                <div style={{ fontFamily: fonts.mono, fontSize: sz.md, color: C.accent }}>{config.signing.algorithm}</div>
              </div>
              <div>
                <Label>{t("keyStore")}</Label>
                <Mono>{config.signing.key_store}</Mono>
              </div>
              <div>
                <Label>{t("storageDriver")}</Label>
                <Mono>{config.storage.driver}</Mono>
              </div>
              <div>
                <Label>{t("encryptionDriver")}</Label>
                <Mono>{config.encryption.driver}</Mono>
              </div>
              <div>
                <Label>{t("dcrMode")}</Label>
                <Mono>{config.dcr.mode}</Mono>
              </div>
            </div>
          </Card>

          {/* Phase 3 Feature Flags */}
          <SectionTitle>{t("featureFlags")}</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 14 }}>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Label>{t("clientCredentials")}</Label>
                <Tag color={config.client_credentials.enabled ? C.success : C.textDim}>
                  {config.client_credentials.enabled ? t("enabled") : t("disabled")}
                </Tag>
              </div>
              <div style={{ fontSize: sz.sm, color: C.textDim }}>
                {t("clientCredentialsDescription")}
              </div>
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Label>DPoP</Label>
                <Tag color={config.dpop.enabled ? C.success : C.textDim}>
                  {config.dpop.enabled ? t("enabled") : t("disabled")}
                </Tag>
              </div>
              {config.dpop.enabled && (
                <div style={{ fontSize: sz.sm, color: C.textDim }}>
                  {t("nonceTtl")}: <Mono>{config.dpop.nonce_ttl || t("default")}</Mono>
                  {" · "}
                  {t("requireNonce")}: <Mono>{config.dpop.require_nonce ? t("yes") : t("no")}</Mono>
                </div>
              )}
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Label>{t("tokenExchange")}</Label>
                <Tag color={config.token_exchange.enabled ? C.success : C.textDim}>
                  {config.token_exchange.enabled ? t("enabled") : t("disabled")}
                </Tag>
              </div>
              {config.token_exchange.enabled && (
                <div style={{ fontSize: sz.sm, color: C.textDim }}>
                  {t("maxChainDepth")}: <Mono>{config.token_exchange.max_chain_depth}</Mono>
                </div>
              )}
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Label>{t("agentIdentity")}</Label>
                <Tag color={config.agents.enabled ? C.purple : C.textDim}>
                  {config.agents.enabled ? t("enabled") : t("disabled")}
                </Tag>
              </div>
              {config.agents.enabled && (
                <div style={{ fontSize: sz.sm, color: C.textDim }}>
                  {t("jwksListing")}: <Mono>{config.agents.jwks_listing ? t("yes") : t("no")}</Mono>
                </div>
              )}
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Label>{t("oidcLogin")}</Label>
                <Tag color={config.oidc.enabled ? C.success : C.textDim}>
                  {config.oidc.enabled ? t("enabled") : t("disabled")}
                </Tag>
              </div>
              <div style={{ fontSize: sz.sm, color: C.textDim }}>
                {t("oidcDescription")}
              </div>
            </Card>
          </div>

          <div style={{ fontSize: sz.sm, color: C.textDim, fontFamily: fonts.mono, marginTop: 8 }}>
            {t("readOnlyNotice")}
          </div>
        </>
      )}
    </div>
  );
}
