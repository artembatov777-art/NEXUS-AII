import { t } from "../lib/i18n";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PROVIDER, type ProviderSettings } from "../types";
import { createProfileCredentialHandle, isDedicatedCredentialHandle } from "../lib/providerCredentials";
import { PROVIDER_PRESETS, getProviderPreset } from "../lib/providerPresets";
import {
  loadDeletedProviderProfileIds, loadProviderProfiles, removeProviderProfile, requestPersistentProviderProfileStorage, saveDeletedProviderProfileIds, saveProviderProfiles,
  upsertProviderProfile, validateProviderProfile, type ProviderProfileRecord
} from "../lib/providerProfiles";

export function ProviderProfilesPanel({
  currentSettings,
  onSelect,
  onDeleteCredential,
  gatewaySessionReady = false
}: {
  currentSettings: ProviderSettings;
  onSelect: (settings: ProviderSettings) => void;
  onDeleteCredential: (credentialHandle: string) => Promise<void>;
  gatewaySessionReady?: boolean;
}) {
  const [profiles, setProfiles] = useState<ProviderProfileRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("");
  const [persistentStorage, setPersistentStorage] = useState(false);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let active = true;
    const loaded = loadProviderProfiles();
    if (!loaded.ok) {
      setStatus(loaded.error.message);
      return () => { active = false; };
    }
    setProfiles(loaded.value);
    const matching = loaded.value.find(profile =>
      JSON.stringify(profile.settings) === JSON.stringify(currentSettings)
    );
    if (matching) setSelectedId(matching.id);

    if (gatewaySessionReady && !isTauri()) {
      void (async () => {
        setSyncing(true);
        try {
          const response = await fetch("/api/profiles", { credentials: "same-origin" });
          const payload = await response.json() as { profiles?: unknown[]; deletedProfileIds?: unknown[]; error?: string };
          if (!response.ok || !Array.isArray(payload.profiles)) {
            throw new Error(payload.error || "Cloud profile storage is unavailable.");
          }
          const remoteDeleted = Array.isArray(payload.deletedProfileIds)
            ? payload.deletedProfileIds.filter((id): id is string =>
              typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id))
            : [];
          const deletedProfileIds = [...new Set([...loadDeletedProviderProfileIds(), ...remoteDeleted])].slice(-256);
          const tombstonesSaved = saveDeletedProviderProfileIds(deletedProfileIds);
          if (!tombstonesSaved.ok) throw new Error(tombstonesSaved.error.message);
          const deleted = new Set(deletedProfileIds);
          const remote: ProviderProfileRecord[] = [];
          for (const item of payload.profiles) {
            const validated = validateProviderProfile(item);
            if (!validated.ok) throw new Error("The cloud profile store contains an invalid profile.");
            if (!deleted.has(validated.value.id)) remote.push(validated.value);
          }
          const mergedById = new Map(remote.map(profile => [profile.id, profile]));
          for (const local of loaded.value) {
            if (deleted.has(local.id)) continue;
            const cloud = mergedById.get(local.id);
            if (!cloud || (local.updatedAt ?? 0) > (cloud.updatedAt ?? 0)) mergedById.set(local.id, local);
          }
          const merged = [...mergedById.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
          const localSaved = saveProviderProfiles(merged);
          if (!localSaved.ok) throw new Error(localSaved.error.message);
          if (JSON.stringify(merged) !== JSON.stringify(remote) ||
              JSON.stringify(deletedProfileIds) !== JSON.stringify(remoteDeleted)) {
            const uploaded = await fetch("/api/profiles", {
              method: "PUT",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ schemaVersion: 1, profiles: merged, deletedProfileIds })
            });
            const result = await uploaded.json() as { error?: string };
            if (!uploaded.ok) throw new Error(result.error || "Could not upload local profiles to cloud storage.");
          }
          if (!active) return;
          setProfiles(merged);
          setStatus("Provider profiles are synchronized with your NEXUS account and this device.");
        } catch (cause) {
          if (active) setStatus("Profiles remain saved on this device, but cloud synchronization failed: " +
            (cause instanceof Error ? cause.message : "Unknown synchronization error."));
        } finally {
          if (active) setSyncing(false);
        }
      })();
    }
    void requestPersistentProviderProfileStorage().then(result => {
      if (active && result === true) setPersistentStorage(true);
    });
    return () => { active = false; };
  }, [gatewaySessionReady, syncAttempt]);

  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === selectedId) ?? null,
    [profiles, selectedId]
  );
  const isDirty = Boolean(selectedProfile &&
    JSON.stringify(selectedProfile.settings) !== JSON.stringify(currentSettings));

  function persist(next: ProviderProfileRecord[], selected: string) {
    const saved = saveProviderProfiles(next);
    if (!saved.ok) {
      setStatus(saved.error.message);
      return false;
    }
    setProfiles(next);
    setSelectedId(selected);
    setStatus("Provider profile saved on this device. API keys remain outside the profile.");
    if (gatewaySessionReady && !isTauri()) {
      void fetch("/api/profiles", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, profiles: next, deletedProfileIds: loadDeletedProviderProfileIds() })
      }).then(async response => {
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Cloud synchronization failed.");
        setStatus("Provider profile saved on this device and synchronized with NEXUS cloud storage.");
      }).catch(cause => setStatus("Profile saved locally, but cloud synchronization failed: " +
        (cause instanceof Error ? cause.message : "Unknown error.")));
    }
    return true;
  }

  function saveAsNew() {
    const nextLabel = label.trim();
    if (!nextLabel) {
      setStatus("Enter a name for this provider profile.");
      return;
    }
    const id = `nexus.profile.${crypto.randomUUID()}`;
    const settings: ProviderSettings = {
      ...currentSettings,
      credentialHandle: currentSettings.credentialHandle === "none"
        ? "none"
        : createProfileCredentialHandle()
    };
    const next = upsertProviderProfile(profiles, { id, label: nextLabel, settings, updatedAt: Date.now() });
    if (!next.ok) {
      setStatus(next.error.message);
      return;
    }
    if (persist(next.value, id)) {
      setLabel("");
      onSelect(settings);
      if (settings.credentialHandle !== "none") {
        setStatus("Profile saved with an isolated key slot. Enter and save its API key in Provider settings.");
      }
    }
  }

  function updateSelected() {
    if (!selectedProfile) return;
    const next = upsertProviderProfile(profiles, {
      id: selectedProfile.id,
      label: selectedProfile.label,
      settings: currentSettings,
      updatedAt: Date.now()
    });
    if (!next.ok) {
      setStatus(next.error.message);
      return;
    }
    if (persist(next.value, selectedProfile.id)) onSelect({ ...currentSettings });
  }

  async function deleteSelected() {
    if (!selectedProfile) return;
    const credentialHandle = selectedProfile.settings.credentialHandle ?? "default";
    const hasDedicatedKey = isDedicatedCredentialHandle(credentialHandle);
    const consequence = hasDedicatedKey
      ? " Its dedicated API key will also be deleted from the OS credential vault."
      : " Any shared API key remains in the OS credential vault.";
    if (!window.confirm(`Delete saved provider profile "${selectedProfile.label}"?${consequence}`)) return;
    const next = removeProviderProfile(profiles, selectedProfile.id);
    if (!next.ok) {
      setStatus(next.error.message);
      return;
    }
    const saved = saveProviderProfiles(next.value);
    if (!saved.ok) {
      setStatus(saved.error.message);
      return;
    }
    if (hasDedicatedKey) {
      try {
        await onDeleteCredential(credentialHandle);
      } catch {
        const restored = saveProviderProfiles(profiles);
        setStatus(restored.ok
          ? "The dedicated API key could not be removed. The profile was restored so you can retry."
          : "The key could not be removed and the profile could not be restored. The unused key may remain in the OS vault.");
        return;
      }
    }
    const deletedProfileIds = [...new Set([...loadDeletedProviderProfileIds(), selectedProfile.id])].slice(-256);
    const tombstonesSaved = saveDeletedProviderProfileIds(deletedProfileIds);
    if (!tombstonesSaved.ok) {
      saveProviderProfiles(profiles);
      setStatus(tombstonesSaved.error.message);
      return;
    }
    setProfiles(next.value);
    setSelectedId("");
    setStatus("Provider profile deleted on this device.");
    if (gatewaySessionReady && !isTauri()) {
      void fetch("/api/profiles", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, profiles: next.value, deletedProfileIds })
      }).then(async response => {
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Cloud synchronization failed.");
        setStatus("Provider profile deleted and synchronized with NEXUS cloud storage.");
      }).catch(cause => setStatus("Profile deleted locally, but cloud synchronization failed: " +
        (cause instanceof Error ? cause.message : "Unknown error.")));
    }
    if (hasDedicatedKey && currentSettings.credentialHandle === credentialHandle) {
      onSelect(DEFAULT_PROVIDER);
    } else {
      onSelect({ ...currentSettings });
    }
  }

  function applyPreset(presetId: string) {
    const preset = getProviderPreset(presetId);
    if (!preset) return;
    const currentHandle = currentSettings.credentialHandle ?? "default";
    const credentialHandle = isDedicatedCredentialHandle(currentHandle) ? currentHandle : "default";
    const browserGatewayUrl = "/api/provider/" + preset.id;
    onSelect({
      ...currentSettings,
      baseUrl: !isTauri() && preset.protocol === "openai-chat-completions" ? browserGatewayUrl : preset.baseUrl,
      model: "",
      providerProtocol: preset.protocol,
      inferenceLocation: "remote",
      credentialHandle
    });
    setStatus(!isTauri() && preset.protocol === "openai-chat-completions"
      ? "Hosted provider route selected. Add this provider's API key to Railway Variables, then use the NEXUS access token."
      : t("Provider preset applied. Save a profile and add its API key in Provider settings."));
  }

  return <section className="provider-profiles" aria-label={t("Saved provider profiles")}>
    {!isTauri() ? <div className="hosted-provider-setup">
      <strong>{t("Connect a model through Railway AI Gateway")}</strong>
      <small>{t("Choose a provider. Every supported cloud provider uses the same protected Railway AI Gateway and remembered device session.")}</small>
      <div className="hosted-provider-grid">
        {PROVIDER_PRESETS.filter(preset => preset.protocol === "openai-chat-completions").map(preset =>
          <button key={preset.id} type="button" className="secondary-btn" onClick={() => applyPreset(preset.id)}>
            {"Use " + preset.label + " on Railway"}
          </button>
        )}
      </div>
    </div> : <label>{t("Quick provider setup")}
      <select aria-label={t("Quick provider setup")} defaultValue="" onChange={event => {
        applyPreset(event.target.value);
        event.currentTarget.value = "";
      }}>
        <option value="">{t("Choose a provider preset…")}</option>
        {PROVIDER_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
      </select>
    </label>}
    <small>{t("Hosted providers: Gemini, Groq and NVIDIA. Ollama remains available separately as a local no-key provider.")}</small>
    <label>Saved provider profiles
      <select aria-label={t("Saved provider profiles")} value={selectedId} onChange={event => {
        const profile = profiles.find(item => item.id === event.target.value);
        if (profile && isDirty && !window.confirm("Discard unsaved changes to the current provider profile and switch?")) return;
        setSelectedId(profile?.id ?? "");
        if (profile) {
          onSelect(profile.settings);
          setStatus("Profile selected. No provider connection was started.");
        }
      }}>
        <option value="">{t("Current unsaved configuration")}</option>
        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
      </select>
    </label>
    <div className="modal-actions">
      <input aria-label={t("New provider profile name")} value={label} onChange={event => setLabel(event.target.value)} placeholder={t("Name this configuration")}/>
      <button className="secondary-btn" type="button" onClick={saveAsNew}>{t("Save as profile")}</button>
      {selectedProfile && <button className="secondary-btn" type="button" onClick={updateSelected} disabled={!isDirty}>{t("Update selected")}</button>}
      {selectedProfile && <button className="secondary-btn" type="button" onClick={deleteSelected}>{t("Delete profile")}</button>}
    </div>
    <small>Profiles are saved on this device without an expiry date. {gatewaySessionReady && !isTauri() ? "Cloud synchronization is enabled for this remembered NEXUS device. " : "Remember the NEXUS device session to synchronize profiles across Safari, Home Screen and desktop browser. "}{persistentStorage
      ? "The browser has also granted persistent storage, protecting them from automatic eviction."
      : "They remain until you delete them or clear this app's/browser's site data. Private browsing may discard them."} API keys are never stored in profiles. Selecting a profile does not connect to it.</small>
    {gatewaySessionReady && !isTauri() && <button
      className="secondary-btn"
      type="button"
      onClick={() => setSyncAttempt(attempt => attempt + 1)}
      disabled={syncing}
    >{syncing ? t("Synchronizing profiles…") : t("Sync profiles now")}</button>}
    {status && <small role="status">{t(status)}</small>}
  </section>;
}
