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

export function VoiceControls({ onTranscript, textToSpeak }: { onTranscript: (text: string) => void; textToSpeak: string }) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");
  const [language, setLanguage] = useState(() => typeof navigator === "undefined" ? "en-US" : (navigator.language || "en-US"));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices());
    updateVoices();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
      recognition.current?.abort();
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
      setError("Speech recognition is not supported in this environment.");
      return;
    }
    try {
      const instance = new Constructor();
      instance.lang = language;
      instance.continuous = false;
      instance.interimResults = true;
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
        setError("Speech recognition error: " + event.error);
        setListening(false);
        setInterim("");
      };
      instance.onend = () => {
        setListening(false);
        setInterim("");
        recognition.current = null;
      };
      recognition.current = instance;
      instance.start();
      setListening(true);
    } catch {
      setError("Could not start speech recognition. Check microphone permission.");
    }
  }

  function toggleSpeak() {
    setError("");
    if (!("speechSynthesis" in window)) {
      setError("Text-to-speech is not supported.");
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    if (!textToSpeak.trim()) {
      setError("There is no assistant response to read yet.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const selectedVoice = voices.find(voice => voice.name === voiceName);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      setError("Text-to-speech failed.");
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return <div className="voice-controls">
    <button type="button" className={listening ? "voice-active" : ""} onClick={toggleListening} aria-label={listening ? "Stop voice input" : "Start voice input"}>
      {listening ? <MicOff size={15} /> : <Mic size={15} />}<span>{listening ? "Listening" : "Voice input"}</span>
    </button>
    <select aria-label="Speech recognition language" value={language} onChange={event => setLanguage(event.target.value)}>
      <option value="ru-RU">Русский</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="fi-FI">Suomi</option>
    </select>
    {voices.length > 0 && <select aria-label="Text-to-speech voice" value={voiceName} onChange={event => setVoiceName(event.target.value)}>
      <option value="">System voice</option>{voices.map(voice => <option key={voice.voiceURI} value={voice.name}>{voice.name}</option>)}
    </select>}
    <button type="button" className={speaking ? "voice-active" : ""} onClick={toggleSpeak} aria-label={speaking ? "Stop reading" : "Read latest response"}>
      {speaking ? <VolumeX size={15} /> : <Volume2 size={15} />}<span>{speaking ? "Stop reading" : "Read response"}</span>
    </button>
    {interim && <small aria-live="polite">{interim}</small>}
    {error && <small role="status">{error}</small>}
  </div>;
}
