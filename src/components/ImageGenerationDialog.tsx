import { t } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Download, ImagePlus, LoaderCircle, X } from "lucide-react";
import { ImageGenerationRouter, type GeneratedImage, type ImageAspectRatio, type ImageSize } from "../core/imageGeneration";
import { createGeminiImageProvider } from "../lib/geminiImageProvider";
import "./image-generation.css";
import { encodeImageSourceFile, type SourceImage } from "../lib/imageSource";

export function ImageGenerationDialog({ accessToken, useGatewayCookie = false, onClose, onGenerated }: { accessToken: string; useGatewayCookie?: boolean; onClose: () => void; onGenerated: (image: GeneratedImage, prompt: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [remoteApproved, setRemoteApproved] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState<GeneratedImage | null>(null);
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const sourceFileInput = useRef<HTMLInputElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !controller.current) onCloseRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      controller.current?.abort();
    };
  }, []);

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
      const router = new ImageGenerationRouter();
      const registered = router.register(createGeminiImageProvider(accessToken, useGatewayCookie));
      if (!registered.ok) throw new Error(registered.error.message);
      const result = await router.generate("gemini-image", {
        prompt,
        aspectRatio,
        imageSize,
        allowRemoteProcessing: remoteApproved,
        ...(sourceImage ? { sourceImage: { mimeType: sourceImage.mimeType, data: sourceImage.data, byteLength: sourceImage.byteLength } } : {})
      }, next.signal);
      if (!result.ok) throw new Error(result.error.message);
      if (!next.signal.aborted) {
        setImage(result.value);
        setSourceImage(null);
        onGenerated(result.value, prompt.trim());
      }
    } catch (cause) {
      if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === next) controller.current = null;
      setWorking(false);
    }
  }

  async function selectSourceFile(file: File | undefined) {
    if (!file) return;
    try {
      const selected = await encodeImageSourceFile(file);
      setSourceImage(selected);
      setImage(null);
      setPrompt("");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the selected image.");
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
        <button type="button" className="icon-btn" onClick={onClose} disabled={working} aria-label={t("Close image generation")}><X size={18}/></button>
      </header>
      <p className="image-generation-disclosure">Uses Gemini 3.1 Flash Image through the secured NEXUS server proxy. Your prompt and {sourceImage ? "source image" : "generated image"} are processed by Google. Do not send private or sensitive information.</p>
      {image && !sourceImage && <button type="button" className="secondary-btn" onClick={() => { setSourceImage(image); setImage(null); setPrompt(""); setError(""); }}>Edit this image</button>}
      {!sourceImage && !image && <button type="button" className="secondary-btn" onClick={() => sourceFileInput.current?.click()}>Choose an image to edit</button>}
      {sourceImage && <div className="image-generation-result">
        <img src={`data:${sourceImage.mimeType};base64,${sourceImage.data}`} alt="Image selected as the source for editing"/>
        <div className="image-generation-source-actions">
          <button type="button" className="secondary-btn" onClick={() => sourceFileInput.current?.click()}>Choose another image</button>
          <button type="button" className="secondary-btn" onClick={() => { setSourceImage(null); setPrompt(""); }}>Cancel edit</button>
        </div>
      </div>}
      <input
        ref={sourceFileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void selectSourceFile(file);
        }}
      />
      <label className="image-generation-prompt">Describe {sourceImage ? "the changes" : "the image"}
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} rows={4} placeholder={sourceImage ? "Describe how you want to change this image…" : "A cinematic photograph of a quiet futuristic city at blue hour…"}/>
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
      <label className="image-generation-consent"><input type="checkbox" checked={remoteApproved} onChange={event => setRemoteApproved(event.target.checked)}/> I agree to send this prompt and {sourceImage ? "source image" : "image request"} to Google Gemini for processing.</label>
      {error && <p className="image-generation-error" role="alert">{t(error)}</p>}
      {working && <p className="image-generation-status" role="status"><LoaderCircle size={16} className="image-generation-spinner"/> Generating image…</p>}
      {image && <div className="image-generation-result">
        <img src={`data:${image.mimeType};base64,${image.data}`} alt={prompt || "Generated image"}/>
        {image.text && <p>{image.text}</p>}
        <div className="image-generation-result-meta">{image.model} · {image.aspectRatio} · {image.imageSize} · {(image.byteLength / 1_000_000).toFixed(2)} MB</div>
        <button type="button" className="primary-btn" onClick={download}><Download size={15}/> Save image</button>
      </div>}
      <footer className="image-generation-actions">
        <button type="button" className="secondary-btn" onClick={onClose} disabled={working}>Close</button>
        <button type="button" className="primary-btn" onClick={() => void generate()} disabled={!working && (!prompt.trim() || !remoteApproved || (!accessToken.trim() && !useGatewayCookie))}>
          {working ? "Stop generation" : <><ImagePlus size={15}/> {sourceImage ? "Edit image" : "Generate image"}</>}
        </button>
      </footer>
    </section>
  </div>;
}
