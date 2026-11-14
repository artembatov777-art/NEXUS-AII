const MAX_BODY_BYTES = 8 * 1024;
const MAX_PROMPT_CHARS = 2_000;
const MODEL = "gemini-3.1-flash-image";
const ASPECT_RATIOS = new Set(["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9"]);
const IMAGE_SIZES = new Set(["1K", "2K"]);

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function readBody(req) {
  if (req.body !== undefined) {
    try {
      const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
        return Promise.reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
      }
      return Promise.resolve(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
    } catch {
      return Promise.reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
    }
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { tooLarge = true; chunks.length = 0; }
      else if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const accessToken = process.env.NEXUS_API_TOKEN;
  if (!apiKey) return sendJson(res, 503, { error: "Gemini provider is not configured." });
  if (!accessToken) return sendJson(res, 503, { error: "NEXUS API access is not configured." });

  const authorization = req.headers.authorization || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(suppliedToken, accessToken)) return sendJson(res, 401, { error: "Unauthorized." });
  if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return sendJson(res, 415, { error: "Content-Type must be application/json." });
  }

  let body;
  try { body = await readBody(req); }
  catch (error) { return sendJson(res, error.statusCode || 400, { error: error.message || "Invalid request." }); }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return sendJson(res, 400, { error: "Prompt must contain 1 to 2,000 characters." });
  }
  const aspectRatio = body.aspectRatio ?? "1:1";
  const imageSize = body.imageSize ?? "1K";
  if (!ASPECT_RATIOS.has(aspectRatio)) return sendJson(res, 400, { error: "Unsupported image aspect ratio." });
  if (!IMAGE_SIZES.has(imageSize)) return sendJson(res, 400, { error: "Unsupported image size." });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            responseFormat: { image: { aspectRatio, imageSize } }
          }
        }),
        signal: controller.signal
      }
    );
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
      return sendJson(res, status, {
        error: status === 429 ? "Gemini image-generation rate limit reached. Try again later."
          : status === 502 ? "Gemini image generation is temporarily unavailable."
            : "Gemini rejected the image-generation request."
      });
    }

    const data = await upstream.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    const image = Array.isArray(parts) ? parts.find(part =>
      typeof part?.inlineData?.data === "string" &&
      ["image/png", "image/jpeg", "image/webp"].includes(part.inlineData.mimeType)
    ) : null;
    if (!image) return sendJson(res, 502, { error: "Gemini returned no supported image." });

    const encoded = image.inlineData.data;
    if (encoded.length > 4_300_000) return sendJson(res, 502, { error: "Generated image exceeded the 3.2 MB response limit for this hosted client." });
    const imageBuffer = Buffer.from(encoded, "base64");
    if (!imageBuffer.length || imageBuffer.length > 3_200_000) {
      return sendJson(res, 502, { error: "Generated image exceeded the 3.2 MB response limit for this hosted client." });
    }
    const mimeType = image.inlineData.mimeType;
    const signatureValid = mimeType === "image/png" ? imageBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mimeType === "image/jpeg" ? imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff
        : imageBuffer.length >= 12 && imageBuffer.toString("ascii", 0, 4) === "RIFF" && imageBuffer.toString("ascii", 8, 12) === "WEBP";
    if (!signatureValid) return sendJson(res, 502, { error: "Gemini returned an invalid image payload." });

    const text = Array.isArray(parts) ? parts.filter(part => typeof part?.text === "string").map(part => part.text).join("").slice(0, 2_000) : "";
    return sendJson(res, 200, {
      image: { mimeType, data: encoded, byteLength: imageBuffer.length },
      text,
      model: MODEL,
      aspectRatio,
      imageSize
    });
  } catch (error) {
    return sendJson(res, error.name === "AbortError" ? 504 : 502, {
      error: error.name === "AbortError" ? "Gemini image generation timed out." : "Could not reach Gemini image generation."
    });
  } finally {
    clearTimeout(timeout);
  }
}
