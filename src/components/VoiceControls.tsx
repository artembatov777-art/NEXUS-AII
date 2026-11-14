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
    case "no-speech": return "No speech was detected. Voice conversation was stopped.";
    case "aborted": return "Voice input was cancelled.";
    default: return "Speech recognition failed. Try another language or input method.";
  }
}

export function VoiceControls({
  onTranscript,
  textToSpeak,
  isGenerating = false
}: {
  onTranscript: (text: string, submitNow?: boolean) => void;
  textToSpeak: string;
  isGenerating?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");
  const [language, setLanguage] = useState(() =>
    typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ru") ? "ru-RU" : "en-US"
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const conversationModeRef = useRef(false);
  const generatingRef = useRef(isGenerating);
  const speakingRef = useRef(false);
  const waitingForResponseRef = useRef(false);
  const lastSpokenTextRef = useRef("");

  onTranscriptRef.current = onTranscript;
  generatingRef.current = isGenerating;
  speakingRef.current = speaking;

  function startRecognition() {
    if (!conversationModeRef.current || generatingRef.current || speakingRef.current || recognition.current) return;
    const host = window as SpeechWindow;
    const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Constructor) {
      setError("Speech recognition is not supported by this browser or desktop WebView.");
      conversationModeRef.current = false;
      setConversationMode(false);
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
        if (finalText.trim()) {
          waitingForResponseRef.current = conversationModeRef.current;
          if (conversationModeRef.current) lastSpokenTextRef.current = textToSpeak;
          onTranscriptRef.current(finalText.trim(), conversationModeRef.current);
          instance.stop();
        }
      };
      instance.onerror = event => {
        setError(recognitionErrorMessage(event.error));
        setListening(false);
        setInterim("");
        if (recognition.current === instance) recognition.current = null;
        if (event.error !== "aborted") {
          conversationModeRef.current = false;
          setConversationMode(false);
          waitingForResponseRef.current = false;
        }
      };
      instance.onend = () => {
        if (recognition.current === instance) recognition.current = null;
        setListening(false);
        setInterim("");
        if (conversationModeRef.current && !waitingForResponseRef.current && !generatingRef.current && !speakingRef.current) {
          startRecognition();
        }
      };
      recognition.current = instance;
      setListening(true);
      instance.start();
    } catch {
      recognition.current = null;
      setListening(false);
      setError("Could not start voice input. Check microphone permission and browser support.");
      conversationModeRef.current = false;
      setConversationMode(false);
    }
  }

  function speakText(value: string, resumeConversation: boolean) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setError("Text-to-speech is not supported by this browser or desktop WebView.");
      if (resumeConversation) {
        conversationModeRef.current = false;
        setConversationMode(false);
      }
      return;
    }
    if (!value.trim()) {
      if (resumeConversation) {
        waitingForResponseRef.current = false;
        startRecognition();
      }
      return;
    }
    const next = new SpeechSynthesisUtterance(value.slice(0, 20_000));
    const selectedVoice = voices.find(voice => voice.name === voiceName);
    if (selectedVoice) next.voice = selectedVoice;
    next.lang = language;
    next.onstart = () => {
      if (utterance.current === next) {
        speakingRef.current = true;
        setSpeaking(true);
      }
    };
    next.onend = () => {
      if (utterance.current === next) {
        utterance.current = null;
        speakingRef.current = false;
        setSpeaking(false);
        if (resumeConversation && conversationModeRef.current) {
          waitingForResponseRef.current = false;
          startRecognition();
        }
      }
    };
    next.onerror = () => {
      if (utterance.current === next) {
        utterance.current = null;
        speakingRef.current = false;
        setSpeaking(false);
        setError("Text-to-speech failed or was interrupted.");
        if (resumeConversation) {
          conversationModeRef.current = false;
          setConversationMode(false);
          waitingForResponseRef.current = false;
        }
      }
    };
    window.speechSynthesis.cancel();
    utterance.current = next;
    speakingRef.current = true;
    setSpeaking(true);
    window.speechSynthesis.speak(next);
  }

  function toggleConversation() {
    setError("");
    if (conversationModeRef.current) {
      conversationModeRef.current = false;
      waitingForResponseRef.current = false;
      setConversationMode(false);
      recognition.current?.abort();
      recognition.current = null;
      window.speechSynthesis?.cancel();
      utterance.current = null;
      speakingRef.current = false;
      setListening(false);
      setSpeaking(false);
      return;
    }
    if (isGenerating) {
      setError("Wait for the current response to finish before starting voice conversation.");
      return;
    }
    if (!(window as SpeechWindow).SpeechRecognition && !(window as SpeechWindow).webkitSpeechRecognition) {
      setError("Speech recognition is not supported by this browser or desktop WebView.");
      return;
    }
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setError("Text-to-speech is not supported by this browser or desktop WebView.");
      return;
    }
    conversationModeRef.current = true;
    waitingForResponseRef.current = false;
    setConversationMode(true);
    startRecognition();
  }

  function toggleListening() {
    setError("");
    if (listening && !conversationModeRef.current) {
      recognition.current?.stop();
      setListening(false);
      setInterim("");
      return;
    }
    if (conversationModeRef.current) return;
    const host = window as SpeechWindow;
    const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Constructor) {
      setError("Speech recognition is not supported by this browser or desktop WebView.");
      return;
    }
    conversationModeRef.current = false;
    try {
      const instance = new Constructor();
      instance.lang = language;
      instance.continuous = false;
      instance.interimResults = true;
      instance.onstart = () => { if (recognition.current === instance) setListening(true); };
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
        if (finalText.trim()) onTranscriptRef.current(finalText.trim(), false);
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
    if (speaking) {
      utterance.current = null;
      window.speechSynthesis.cancel();
      speakingRef.current = false;
      setSpeaking(false);
      if (conversationModeRef.current) {
        waitingForResponseRef.current = false;
        startRecognition();
      }
      return;
    }
    if (!textToSpeak.trim()) {
      setError("There is no assistant response to read yet.");
      return;
    }
    speakText(textToSpeak, false);
  }

  useEffect(() => {
    const speech = "speechSynthesis" in window ? window.speechSynthesis : null;
    const updateVoices = () => {
      if (speech) setVoices(speech.getVoices());
    };
    if (speech) {
      updateVoices();
      speech.addEventListener("voiceschanged", updateVoices);
    }
    return () => {
      conversationModeRef.current = false;
      waitingForResponseRef.current = false;
      recognition.current?.abort();
      recognition.current = null;
      utterance.current = null;
      speech?.removeEventListener("voiceschanged", updateVoices);
      speech?.cancel();
    };
  }, []);

  useEffect(() => {
    if (isGenerating) {
      if (conversationModeRef.current) {
        if (!waitingForResponseRef.current) lastSpokenTextRef.current = textToSpeak;
        waitingForResponseRef.current = true;
      }
      recognition.current?.stop();
      return;
    }
    if (waitingForResponseRef.current && conversationModeRef.current && !speakingRef.current) {
      const latest = textToSpeak.trim();
      if (latest && latest !== lastSpokenTextRef.current) speakText(latest, true);
      else {
        waitingForResponseRef.current = false;
        startRecognition();
      }
    }
  }, [isGenerating, textToSpeak]);

  return <div className="voice-controls">
    <button type="button" className={conversationMode ? "voice-active" : ""} onClick={toggleConversation} disabled={isGenerating && !conversationMode} aria-label={conversationMode ? "End voice conversation" : "Start voice conversation"}>
      {conversationMode ? <MicOff size={15}/> : <Mic size={15}/>}<span>{conversationMode ? "End conversation" : "Voice conversation"}</span>
    </button>
    <button type="button" className={listening ? "voice-active" : ""} onClick={toggleListening} disabled={conversationMode || isGenerating} aria-label={listening ? "Stop voice input" : "Start voice input"}>
      {listening && !conversationMode ? <MicOff size={15}/> : <Mic size={15}/>}<span>{listening && !conversationMode ? "Listening" : "Voice input"}</span>
    </button>
    <select aria-label="Speech recognition language" value={language} disabled={listening || speaking} onChange={event => setLanguage(event.target.value)}>
      <option value="ru-RU">Русский</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="fi-FI">Suomi</option>
    </select>
    {voices.length > 0 && <select aria-label="Text-to-speech voice" value={voiceName} disabled={speaking} onChange={event => setVoiceName(event.target.value)}>
      <option value="">System voice</option>{voices.map(voice => <option key={voice.voiceURI} value={voice.name}>{voice.name}</option>)}
    </select>}
    <button type="button" className={speaking ? "voice-active" : ""} onClick={toggleSpeak} aria-label={speaking ? "Stop reading" : "Read latest response"}>
      {speaking ? <VolumeX size={15}/> : <Volume2 size={15}/>}<span>{speaking ? "Stop reading" : "Read response"}</span>
    </button>
    {interim && <small aria-live="polite">{interim}</small>}
    {error && <small role="status">{error}</small>}
    <small className="voice-note">Voice conversation automatically sends recognized speech to the selected AI provider and reads the answer aloud. Speech recognition may use an online service provided by the browser or desktop WebView. Do not dictate sensitive information unless you trust that service; offline support depends on the host system.</small>
  </div>;
}
