export type Modality = "text" | "image" | "audio" | "document";
export type InferenceLocation = "local" | "remote";

export interface ModelModalityCapabilities {
  modelId: string;
  location: InferenceLocation;
  modalities: Modality[];
}

export interface MultimodalAttachment {
  id: string;
  kind: Exclude<Modality, "text">;
  mimeType: string;
  byteLength: number;
  sourceLabel: string;
}

export interface MultimodalRequestPolicy {
  model: ModelModalityCapabilities;
  requiredModalities: Modality[];
  attachments: MultimodalAttachment[];
  allowRemoteProcessing: boolean;
  maxPayloadBytes?: number;
}

export type MultimodalPolicyResult =
  | { allowed: true; location: InferenceLocation; totalBytes: number }
  | { allowed: false; reason: string };

const MIME_TYPES: Record<MultimodalAttachment["kind"], string[]> = {
  image: ["image/png", "image/jpeg", "image/webp"],
  audio: ["audio/wav", "audio/mpeg", "audio/ogg", "audio/webm"],
  document: ["application/pdf", "text/plain", "text/markdown"]
};

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function evaluateMultimodalPolicy(policy: MultimodalRequestPolicy): MultimodalPolicyResult {
  if (!policy || typeof policy !== "object") {
    return { allowed: false, reason: "The multimodal request policy is invalid." };
  }
  const { model, requiredModalities, attachments } = policy;
  if (!model || typeof model !== "object" || !boundedText(model.modelId, 160)) {
    return { allowed: false, reason: "A valid model ID is required." };
  }
  if (!["local", "remote"].includes(model.location)) return { allowed: false, reason: "The model processing location is invalid." };
  if (!Array.isArray(model.modalities) || model.modalities.length === 0 ||
      model.modalities.some(item => !["text", "image", "audio", "document"].includes(item)) ||
      new Set(model.modalities).size !== model.modalities.length) {
    return { allowed: false, reason: "The selected model capability declaration is invalid." };
  }
  if (typeof policy.allowRemoteProcessing !== "boolean") {
    return { allowed: false, reason: "Remote-processing consent must be explicit." };
  }
  if (!Array.isArray(requiredModalities) || requiredModalities.length === 0 ||
      requiredModalities.some(item => !["text", "image", "audio", "document"].includes(item)) ||
      new Set(requiredModalities).size !== requiredModalities.length) {
    return { allowed: false, reason: "The required modality list is invalid." };
  }
  if (!Array.isArray(attachments) || attachments.length > 32) {
    return { allowed: false, reason: "A request may contain at most 32 attachments." };
  }
  if (requiredModalities.some(modality => !model.modalities.includes(modality))) {
    return { allowed: false, reason: "The selected model does not support every requested modality." };
  }
  if (model.location === "remote" && !policy.allowRemoteProcessing) {
    return { allowed: false, reason: "Remote processing requires explicit owner approval." };
  }

  let totalBytes = 0;
  const ids = new Set<string>();
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object" ||
        !boundedText(attachment.id, 160) || ids.has(attachment.id) ||
        !boundedText(attachment.sourceLabel, 300) ||
        !MIME_TYPES[attachment.kind]?.includes(attachment.mimeType) ||
        !Number.isSafeInteger(attachment.byteLength) || attachment.byteLength <= 0) {
      return { allowed: false, reason: "An attachment has invalid identity, source, MIME type, or size metadata." };
    }
    ids.add(attachment.id);
    totalBytes += attachment.byteLength;
    if (!Number.isSafeInteger(totalBytes)) return { allowed: false, reason: "Attachment size total is invalid." };
  }
  const maxBytes = policy.maxPayloadBytes ?? 20_000_000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || totalBytes > maxBytes) {
    return { allowed: false, reason: "The multimodal payload exceeds the configured size limit." };
  }
  const attachmentModalities = new Set(attachments.map(item => item.kind));
  if ([...attachmentModalities].some(kind => !requiredModalities.includes(kind))) {
    return { allowed: false, reason: "The attachment list contains a modality not declared by the request." };
  }
  return { allowed: true, location: model.location, totalBytes };
}
