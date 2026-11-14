import { describe, expect, it } from "vitest";
import { LocalTransformerEmbeddingProvider } from "./localEmbeddings";

describe("LocalTransformerEmbeddingProvider", () => {
  it("rejects invalid batches before loading the model", async () => {
    let loads = 0;
    const provider = new LocalTransformerEmbeddingProvider(async () => {
      loads += 1;
      return async texts => ({ tolist: () => texts.map(() => [1, 0]) });
    });

    const empty = await provider.embed([]);
    const oversized = await provider.embed(Array.from({ length: 501 }, () => "valid text"));

    expect(empty).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(oversized).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(loads).toBe(0);
  });

  it("honors an already-aborted signal without loading the model", async () => {
    let loads = 0;
    const provider = new LocalTransformerEmbeddingProvider(async () => {
      loads += 1;
      return async texts => ({ tolist: () => texts.map(() => [1, 0]) });
    });
    const controller = new AbortController();
    controller.abort();

    const result = await provider.embed(["hello"], controller.signal);

    expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(loads).toBe(0);
  });

  it("converts pooled tensor output into finite vectors", async () => {
    const provider = new LocalTransformerEmbeddingProvider(async () =>
      async texts => ({ tolist: () => texts.map((_, index) => [index + 0.25, 0.75]) })
    );

    const result = await provider.embed(["first", "second"]);

    expect(result).toEqual({ ok: true, value: [[0.25, 0.75], [1.25, 0.75]] });
  });

  it("returns cancellation when the signal is aborted during model inference", async () => {
    const controller = new AbortController();
    const provider = new LocalTransformerEmbeddingProvider(async () =>
      async texts => {
        controller.abort();
        return { tolist: () => texts.map(() => [1, 0]) };
      }
    );
    const result = await provider.embed(["hello"], controller.signal);
    expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
  });

  it("rejects malformed or non-finite tensor output", async () => {
    const provider = new LocalTransformerEmbeddingProvider(async () =>
      async () => ({ tolist: () => [[Number.NaN]] })
    );

    const result = await provider.embed(["hello"]);

    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
  });
});
