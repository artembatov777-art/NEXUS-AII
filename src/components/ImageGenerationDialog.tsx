import { useEffect, useRef, useState } from "react";
import { Download, ImagePlus, LoaderCircle, X } from "lucide-react";
import { generateGeminiImage, type GeneratedImage, type ImageAspectRatio, type ImageSize } from "../lib/geminiImageGeneration";
import "./image-generation.css";

export function ImageGenerationDialog({ accessToken, onClose }: { accessToken: string; onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [remoteApproved, setRemoteApproved] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState<GeneratedImage | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !controller.current) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      controller.current?.abort();
    };
  }, [onClose]);

  async function generate() {
    if (working) {
      controller.current?.abort();
      return;
    }
    if (!remoteApproved) {
      setError("Confirm remote processing before sending this prompt to Gemini.");
      return;
    }
    const next = new AbortController();
    controller.current = next;
    setWorking(true);
    setError("");
    setImage(null);
    try {
      const result = await generateGeminiImage(prompt, accessToken, {
        aspectRatio,
        imageSize,
        signal: next.signal
      });
      if (!next.signal.aborted) setImage(result);
    } catch (cause) {
      if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === next) controller.current = null;
      setWorking(false);
    }
  }

  function download() {
    if (!image) return;
    const binary = atob(image.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: image.mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nexus-image-${Date.now()}.${image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1]}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="image-generation-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !working) onClose(); }}>
    <section className="image-generation-dialog" role="dialog" aria-modal="true" aria-labelledby="image-generation-title">
      <header className="image-generation-header">
        <div><span className="eyebrow">NEXUS MULTIMODAL</span><h2 id="image-generation-title">Image generation</h2></div>
        <button type="button" className="icon-btn" onClick={onClose} disabled={working} aria-label="Close image generation"><X size={18}/></button>
      </header>
      <p className="image-generation-disclosure">Uses Gemini 3.1 Flash Image through the secured NEXUS server proxy. Your prompt and generated image are processed by Google. Do not send private or sensitive information.</p>
      <label className="image-generation-prompt">Describe the image
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} rows={4} placeholder="A cinematic photograph of a quiet futuristic city at blue hour…"/>
        <small>{prompt.length}/2000</small>
      </label>
      <div className="image-generation-options">
        <label>Aspect ratio
          <select value={aspectRatio} onChange={event => setAspectRatio(event.target.value as ImageAspectRatio)}>
            <option value="1:1">Square · 1:1</option><option value="16:9">Landscape · 16:9</option><option value="9:16">Portrait · 9:16</option><option value="3:2">Photo · 3:2</option><option value="2:3">Portrait photo · 2:3</option><option value="4:3">Classic · 4:3</option><option value="3:4">Portrait classic · 3:4</option><option value="5:4">Wide · 5:4</option><option value="4:5">Portrait · 4:5</option><option value="21:9">Ultrawide · 21:9</option>
          </select>
        </label>
        <label>Resolution
          <select value={imageSize} onChange={event => setImageSize(event.target.value as ImageSize)}>
            <option value="1K">1K</option><option value="2K">2K</option>
          </select>
        </label>
      </div>
      <label className="image-generation-consent"><input type="checkbox" checked={remoteApproved} onChange={event => setRemoteApproved(event.target.checked)}/> I agree to send this prompt to Google Gemini for image generation.</label>
      {error && <p className="image-generation-error" role="alert">{error}</p>}
      {working && <p className="image-generation-status" role="status"><LoaderCircle size={16} className="image-generation-spinner"/> Generating image…</p>}
      {image && <div className="image-generation-result">
        <img src={`data:${image.mimeType};base64,${image.data}`} alt={prompt || "Generated image"}/>
        {image.text && <p>{image.text}</p>}
        <div className="image-generation-result-meta">{image.model} · {image.aspectRatio} · {image.imageSize} · {(image.byteLength / 1_000_000).toFixed(2)} MB</div>
        <button type="button" className="primary-btn" onClick={download}><Download size={15}/> Save image</button>
      </div>}
      <footer className="image-generation-actions">
        <button type="button" className="secondary-btn" onClick={onClose} disabled={working}>Close</button>
        <button type="button" className="primary-btn" onClick={() => void generate()} disabled={!working && (!prompt.trim() || !remoteApproved || !accessToken.trim())}>
          {working ? "Stop generation" : <><ImagePlus size={15}/> Generate image</>}
        </button>
      </footer>
    </section>
  </div>;
}
