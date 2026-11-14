import { useEffect, useMemo, useState } from "react";
import type { ProviderSettings } from "../types";
import {
  loadProviderProfiles, removeProviderProfile, saveProviderProfiles,
  upsertProviderProfile, type ProviderProfileRecord
} from "../lib/providerProfiles";

export function ProviderProfilesPanel({
  currentSettings,
  onSelect
}: {
  currentSettings: ProviderSettings;
  onSelect: (settings: ProviderSettings) => void;
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
    setStatus("Provider profile saved locally. API keys remain in the OS credential vault.");
    return true;
  }

  function saveAsNew() {
    const nextLabel = label.trim();
    if (!nextLabel) {
      setStatus("Enter a name for this provider profile.");
      return;
    }
    const id = `nexus.profile.${crypto.randomUUID()}`;
    const next = upsertProviderProfile(profiles, { id, label: nextLabel, settings: currentSettings });
    if (!next.ok) {
      setStatus(next.error.message);
      return;
    }
    if (persist(next.value, id)) setLabel("");
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

  function deleteSelected() {
    if (!selectedProfile) return;
    if (!window.confirm(`Delete saved provider profile "${selectedProfile.label}"? Its API key remains in the OS credential vault.`)) return;
    const next = removeProviderProfile(profiles, selectedProfile.id);
    if (!next.ok) {
      setStatus(next.error.message);
      return;
    }
    persist(next.value, "");
  }

  return <section className="provider-profiles" aria-label="Saved provider profiles">
    <label>Saved provider profiles
      <select aria-label="Saved provider profiles" value={selectedId} onChange={event => {
        const profile = profiles.find(item => item.id === event.target.value);
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
