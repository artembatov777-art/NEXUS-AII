import type { ProviderSettings } from "../types";

/** Local no-key profiles are usable without a cloud credential-vault entry. */
export function canUseAgentProvider(settings: ProviderSettings, hasProviderKey: boolean): boolean {
  return hasProviderKey || settings.credentialHandle === "none";
}
