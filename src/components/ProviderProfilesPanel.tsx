import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PROVIDER, type ProviderSettings } from "../types";
import { createProfileCredentialHandle, isDedicatedCredentialHandle } from "../lib/providerCredentials";
import {
  loadProviderProfiles, removeProviderProfile, saveProviderProfiles,
  upsertProviderProfile, type ProviderProfileRecord
} from "../lib/providerProfiles";

export function ProviderProfilesPanel({
  currentSettings,
  onSelect,
  onDeleteCredential
}: {
  currentSettings: ProviderSettings;
  onSelect: (settings: ProviderSettings) => void;
  onDeleteCredential: (credentialHandle: string) => Promise<void>;
}) {
  const [profiles, setProfiles] = useState<ProviderProfileRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const loaded = loadProviderProfiles();
    if (!loaded.ok) {
      setStatus(loaded.error.message);
      return;
    }
    setProfiles(loaded.value);
    const matching = loaded.value.find(profile =>
      JSON.stringify(profile.settings) === JSON.stringify(currentSettings)
    );
    if (matching) setSelectedId(matching.id);
  }, []);

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
    setStatus("Provider profile saved locally. API keys remain in OS credential-vault entries.");
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
    const next = upsertProviderProfile(profiles, { id, label: nextLabel, settings });
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
      settings: currentSettings
    });
    if (!next.ok) {
      setStatus(next.error.message);
      return;
    }
    persist(next.value, selectedProfile.id);
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
    setProfiles(next.value);
    setSelectedId("");
    setStatus("Provider profile deleted.");
    if (hasDedicatedKey && currentSettings.credentialHandle === credentialHandle) {
      onSelect(DEFAULT_PROVIDER);
    }
  }

  return <section className="provider-profiles" aria-label="Saved provider profiles">
    <label>Saved provider profiles
      <select aria-label="Saved provider profiles" value={selectedId} onChange={event => {
        const profile = profiles.find(item => item.id === event.target.value);
        if (profile && isDirty && !window.confirm("Discard unsaved changes to the current provider profile and switch?")) return;
        setSelectedId(profile?.id ?? "");
        if (profile) {
          onSelect(profile.settings);
          setStatus("Profile selected. No provider connection was started.");
        }
      }}>
        <option value="">Current unsaved configuration</option>
        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
      </select>
    </label>
    <div className="modal-actions">
      <input aria-label="New provider profile name" value={label} onChange={event => setLabel(event.target.value)} placeholder="Name this configuration"/>
      <button className="secondary-btn" type="button" onClick={saveAsNew}>Save as profile</button>
      {selectedProfile && <button className="secondary-btn" type="button" onClick={updateSelected} disabled={!isDirty}>Update selected</button>}
      {selectedProfile && <button className="secondary-btn" type="button" onClick={deleteSelected}>Delete profile</button>}
    </div>
    <small>Profiles store endpoint, model, declared route and credential handle only. API keys are never stored here. Selecting a profile does not connect to it.</small>
    {status && <small role="status">{status}</small>}
  </section>;
}
