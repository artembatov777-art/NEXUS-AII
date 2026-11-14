import { describe, expect, it } from "vitest";
import { evaluateMultimodalPolicy, type MultimodalRequestPolicy } from "./multimodal";

const base: MultimodalRequestPolicy = {
  model: { modelId: "vision-model", location: "remote", modalities: ["text", "image"] },
  requiredModalities: ["text", "image"],
  attachments: [{ id: "image-1", kind: "image", mimeType: "image/png", byteLength: 1024, sourceLabel: "Selected image" }],
  allowRemoteProcessing: true
};

describe("multimodal processing policy", () => {
  it("allows a supported remote image request only with explicit approval", () => {
    expect(evaluateMultimodalPolicy(base)).toMatchObject({ allowed: true, location: "remote", totalBytes: 1024 });
  });

  it("blocks remote processing unless the owner approved it", () => {
    expect(evaluateMultimodalPolicy({ ...base, allowRemoteProcessing: false })).toMatchObject({ allowed: false });
  });

  it("rejects modalities unsupported by the selected model", () => {
    expect(evaluateMultimodalPolicy({
      ...base,
      model: { ...base.model, modalities: ["text"] }
    })).toMatchObject({ allowed: false, reason: expect.stringMatching(/does not support/) });
  });

  it("rejects unsafe or mismatched attachment MIME types", () => {
    expect(evaluateMultimodalPolicy({
      ...base,
      attachments: [{ ...base.attachments[0], mimeType: "application/octet-stream" }]
    })).toMatchObject({ allowed: false });
  });

  it("rejects duplicate attachment IDs", () => {
    expect(evaluateMultimodalPolicy({
      ...base,
      attachments: [base.attachments[0], base.attachments[0]]
    })).toMatchObject({ allowed: false });
  });

  it("enforces payload bounds", () => {
    expect(evaluateMultimodalPolicy({
      ...base,
      attachments: [{ ...base.attachments[0], byteLength: 30_000_000 }]
    })).toMatchObject({ allowed: false, reason: expect.stringMatching(/size limit/) });
  });

  it("rejects malformed model capability declarations without throwing", () => {
    expect(evaluateMultimodalPolicy({
      ...base,
      model: { ...base.model, modalities: undefined as unknown as Modality[] }
    })).toMatchObject({ allowed: false, reason: expect.stringMatching(/capability declaration/) });
  });

  it("rejects malformed attachment entries without throwing", () => {
    expect(evaluateMultimodalPolicy({
      ...base,
      attachments: [null as unknown as MultimodalRequestPolicy["attachments"][number]]
    })).toMatchObject({ allowed: false });
  });

  it("requires an explicit boolean for remote-processing consent", () => {
    expect(evaluateMultimodalPolicy({
      ...base,
      allowRemoteProcessing: undefined as unknown as boolean
    })).toMatchObject({ allowed: false, reason: expect.stringMatching(/consent must be explicit/) });
  });

  it("rejects undeclared attachment modalities", () => {
    expect(evaluateMultimodalPolicy({
      ...base,
      requiredModalities: ["text"],
    })).toMatchObject({ allowed: false });
  });
});
