import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";

type RecognitionAlternative = { transcript: string };
type RecognitionResult = ArrayLike<RecognitionAlternative> & { isFinal: boolean };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionError = { error: string };
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechWindow extends Window {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
}

function recognitionErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed": return "Microphone access was denied. Check this app's microphone permission.";
    case "audio-capture": return "No usable microphone was found.";
    case "network": return "The speech service is unavailable. Check your connection and try again.";
    case "no-speech": return "No speech was detected. Try again in a quieter place.";
    case "aborted": return "Voice input was cancelled.";
    default: return "Speech recognition failed. Try another language or input method.";
  }
}

export function VoiceControls({ onTranscript, textToSpeak }: { onTranscript: (text: string) => void; textToSpeak: string }) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");
  const [language, setLanguage] = useState(() =>
    typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ru") ? "ru-RU" : "en-US"
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices());
    updateVoices();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
      recognition.current?.abort();
      recognition.current = null;
      utterance.current = null;
      window.speechSynthesis.cancel();
    };
  }, []);

  function toggleListening() {
    setError("");
    if (listening) {
      recognition.current?.stop();
      setListening(false);
      setInterim("");
      return;
    }
    const host = window as SpeechWindow;
    const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Constructor) {
      setError("Speech recognition is not supported by this browser or desktop WebView.");
      return;
    }
    try {
      const instance = new Constructor();
      instance.lang = language;
      instance.continuous = false;
      instance.interimResults = true;
      instance.onstart = () => {
        if (recognition.current === instance) setListening(true);
      };
      instance.onresult = event => {
        let finalText = "";
        let partialText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result?.[0]?.transcript) continue;
          if (result.isFinal) finalText += result[0].transcript;
          else partialText += result[0].transcript;
        }
        setInterim(partialText);
        if (finalText.trim()) onTranscript(finalText.trim());
      };
      instance.onerror = event => {
        setError(recognitionErrorMessage(event.error));
        setListening(false);
        setInterim("");
        if (recognition.current === instance) recognition.current = null;
      };
      instance.onend = () => {
        if (recognition.current === instance) recognition.current = null;
        setListening(false);
        setInterim("");
      };
      recognition.current = instance;
      setListening(true);
      instance.start();
    } catch {
      recognition.current = null;
      setListening(false);
      setInterim("");
      setError("Could not start voice input. Check microphone permission and browser support.");
    }
  }

  function toggleSpeak() {
    setError("");
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setError("Text-to-speech is not supported by this browser or desktop WebView.");
      return;
    }
    if (speaking) {
      utterance.current = null;
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    if (!textToSpeak.trim()) {
      setError("There is no assistant response to read yet.");
      return;
    }
    const next = new SpeechSynthesisUtterance(textToSpeak.slice(0, 20_000));
    const selectedVoice = voices.find(voice => voice.name === voiceName);
    if (selectedVoice) next.voice = selectedVoice;
    next.onstart = () => {
      if (utterance.current === next) setSpeaking(true);
    };
    next.onend = () => {
      if (utterance.current === next) {
        utterance.current = null;
        setSpeaking(false);
      }
    };
    next.onerror = () => {
      if (utterance.current === next) {
        utterance.current = null;
        setSpeaking(false);
        setError("Text-to-speech failed or was interrupted.");
      }
    };
    window.speechSynthesis.cancel();
    utterance.current = next;
    setSpeaking(true);
    window.speechSynthesis.speak(next);
  }

  return <div className="voice-controls">
    <button type="button" className={listening ? "voice-active" : ""} onClick={toggleListening} aria-label={listening ? "Stop voice input" : "Start voice input"}>
      {listening ? <MicOff size={15} /> : <Mic size={15} />}<span>{listening ? "Listening" : "Voice input"}</span>
    </button>
    <select aria-label="Speech recognition language" value={language} disabled={listening} onChange={event => setLanguage(event.target.value)}>
      <option value="ru-RU">Русский</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="fi-FI">Suomi</option>
    </select>
    {voices.length > 0 && <select aria-label="Text-to-speech voice" value={voiceName} disabled={speaking} onChange={event => setVoiceName(event.target.value)}>
      <option value="">System voice</option>{voices.map(voice => <option key={voice.voiceURI} value={voice.name}>{voice.name}</option>)}
    </select>}
    <button type="button" className={speaking ? "voice-active" : ""} onClick={toggleSpeak} aria-label={speaking ? "Stop reading" : "Read latest response"}>
      {speaking ? <VolumeX size={15} /> : <Volume2 size={15} />}<span>{speaking ? "Stop reading" : "Read response"}</span>
    </button>
    {interim && <small aria-live="polite">{interim}</small>}
    {error && <small role="status">{error}</small>}
    <small className="voice-note">Voice services are provided by the browser or desktop WebView; language and offline support depend on the host system.</small>
  </div>;
}
