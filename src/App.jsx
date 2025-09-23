import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Wifi, BatteryFull, SignalHigh, Plus, X, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";

// --- Constantes ---
const MAX_CACHE_SIZE = 50;
const VITE_GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;

// --- Cache pour le Text-to-Speech (TTS) ---
const ttsCache = new Map();

/**
 * Génère ou récupère l'audio TTS depuis le cache ou une API Render
 */
async function generateTTSWithCache(sentence, voice = "fr-FR-DeniseNeural") {
  const cacheKey = `${voice}_${sentence}`;
  if (ttsCache.has(cacheKey)) return ttsCache.get(cacheKey);

  try {
    const response = await fetch("https://seo-tool-cd8x.onrender.com/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence, voice }),
    });

    if (!response.ok) throw new Error(`Erreur HTTP TTS: ${response.status}`);

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    if (ttsCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = ttsCache.keys().next().value;
      const oldestUrl = ttsCache.get(oldestKey);
      URL.revokeObjectURL(oldestUrl);
      ttsCache.delete(oldestKey);
    }
    ttsCache.set(cacheKey, audioUrl);
    return audioUrl;
  } catch (error) {
    console.error("❌ Erreur lors de la génération TTS:", error);
    throw error;
  }
}

/**
 * Découpe un texte en phrases et les lit une par une, en gérant l'interruption.
 */
async function speakLongText(text, setIsPlayingTTS, audioRef, stopFlagRef) {
  // ✅ Étape 1: On réinitialise le drapeau au tout début d'une NOUVELLE lecture.
  // C'est ce qui garantit que la lecture suivante n'est pas interrompue par erreur.
  stopFlagRef.current = false;

  setIsPlayingTTS(true);
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];

  for (const sentence of sentences) {
    // ✅ Étape 2: Avant chaque phrase, on vérifie si l'utilisateur a demandé l'arrêt.
    if (stopFlagRef.current) {
      break; // Sort de la boucle de lecture
    }
    if (!sentence.trim()) continue;

    try {
      const audioUrl = await generateTTSWithCache(sentence.trim());
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      // Attend la fin de la lecture de la phrase
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);

        // Cette fonction vérifie en continu si on doit s'arrêter
        const checkForStop = () => {
          if (stopFlagRef.current) {
            audio.pause();
            reject(new Error("Playback stopped by user"));
          } else if (!audio.paused) {
            requestAnimationFrame(checkForStop);
          }
        };
        checkForStop();
      });

    } catch (err) {
      if (err.message !== "Playback stopped by user") {
        console.error("Erreur TTS phrase:", err);
      }
      break; // Sort de la boucle en cas d'erreur ou d'arrêt
    }
  }

  // ✅ Étape 3: Nettoyage final, quoi qu'il arrive (fin normale ou interruption).
  setIsPlayingTTS(false);
  audioRef.current = null;
  stopFlagRef.current = false; // Sécurité supplémentaire
}

export default function App() {
  // --- États ---
  const [messages, setMessages] = useState([
    { from: "bot", text: "Bonjour 👋 Je suis ton assistant vocal." },
  ]);
  const [newMessage, setNewMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);
  const [isBotLoading, setIsBotLoading] = useState(false);

  // --- Références ---
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRef = useRef(null);
  const stopFlagRef = useRef(false); // Le drapeau pour l'arrêt immédiat

  // Ajout d’un message dans l’historique
  const addMessage = useCallback((text, from) => {
    setMessages((prev) => [...prev, { from, text }]);
  }, []);

  // Stop TTS
  const stopTTS = useCallback(() => {
    // Cette fonction ne fait qu'une chose : lever le drapeau d'arrêt.
    // La boucle de lecture dans speakLongText s'en occupera.
    stopFlagRef.current = true;
  }, []);

  // --- Effet déclenché quand un user envoie un message ---
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.from === "user") {
      const callLLM = async () => {
        setIsBotLoading(true);

        const groqMessages = [
          { role: "system", content: "Tu es un assistant vocal utile, concis et amical." },
          ...messages.map((m) => ({
            role: m.from === "user" ? "user" : "assistant",
            content: m.text,
          })),
        ];

        try {
          const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${VITE_GROQ_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              // ✅ Modèle original conservé
              model: "llama-3.3-70b-versatile",
              messages: groqMessages,
            }),
          });

          if (!response.ok) {
            const errorDetails = await response.json().catch(() => ({}));
            throw new Error(
              `Erreur ${response.status}: ${errorDetails.error?.message || "Problème API"}`
            );
          }

          const data = await response.json();
          const botText =
            data.choices?.[0]?.message?.content || "Désolé, une erreur est survenue.";

          addMessage(botText, "bot");

          // Lancement de la lecture
          await speakLongText(botText, setIsPlayingTTS, audioRef, stopFlagRef);

        } catch (err) {
          console.error("Erreur dans callLLM:", err);
          addMessage(`❌ ${err.message}`, "bot");
        } finally {
          setIsBotLoading(false);
        }
      };

      callLLM();
    }
  }, [messages, addMessage]);

  // --- Transcription Audio (STT) ---
  const handleTranscription = useCallback(
    async (audioBlob) => {
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");
      formData.append("model", "whisper-large-v3");

      try {
        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${VITE_GROQ_API_KEY}` },
          body: formData,
        });

        if (!response.ok) throw new Error(`Erreur API Whisper: ${response.statusText}`);

        const data = await response.json();
        if (data.text) addMessage(data.text, "user");
      } catch (error) {
        console.error("Erreur de transcription (STT):", error);
        addMessage("❌ Erreur lors de la transcription de l'audio.", "bot");
      }
    },
    [addMessage]
  );

  // --- Micro ---
  const handleMicClick = useCallback(async () => {
    stopTTS();
    if (isRecording) {
      mediaRecorderRef.current?.stop();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        mediaRecorderRef.current = mediaRecorder;

        audioChunksRef.current = [];
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          handleTranscription(audioBlob);
          stream.getTracks().forEach((track) => track.stop());
          setIsRecording(false);
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Erreur d'accès au micro:", err);
        alert("Impossible d'accéder au microphone.");
      }
    }
  }, [isRecording, stopTTS, handleTranscription]);

  // --- Envoi texte ---
  const handleSend = useCallback(
    (e) => {
      e.preventDefault();
      stopTTS(); // Arrête toute lecture en cours
      if (!newMessage.trim() || isBotLoading) return;
      addMessage(newMessage, "user");
      setNewMessage("");
    },
    [newMessage, isBotLoading, addMessage, stopTTS]
  );

  // Nettoyage audio à la fermeture du composant
  useEffect(() => {
    return () => {
      stopTTS();
    };
  }, [stopTTS]);

  return (
    <div className="bg-white text-[#191970] min-h-screen font-[Cinzel] flex flex-col">
      <div className="container mx-auto px-4 pt-6 flex flex-col flex-grow">
        {/* Header */}
        <header className="flex justify-between items-center mb-6">
          <h1 className="text-lg font-semibold">Assistant Vocal</h1>
          <div className="flex items-center space-x-2 text-sm">
            <SignalHigh className="w-5 h-5" /> <Wifi className="w-5 h-5" />
            <span>77%</span> <BatteryFull className="w-5 h-5" />
          </div>
        </header>

        {/* Chat */}
        <main className="flex-grow overflow-y-auto space-y-4 text-xl pb-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`p-4 rounded-xl max-w-[85%] border shadow-sm ${
                msg.from === "user"
                  ? "ml-auto bg-[#191970] text-white"
                  : "mr-auto bg-gray-100 text-[#191970]"
              }`}
            >
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          ))}
        </main>

        {/* Footer */}
        <footer className="sticky bottom-0 py-4 bg-white">
          <form onSubmit={handleSend} className="flex items-center gap-2 mb-4">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Écrire un message..."
              className="flex-grow border border-gray-400 rounded-lg px-3 py-2 bg-white text-[#191970] focus:outline-none focus:ring-2 focus:ring-[#191970]"
              disabled={isBotLoading || isRecording}
            />
            <button
              type="submit"
              className="bg-[#191970] text-white px-4 py-2 rounded-lg hover:bg-blue-900 transition-colors disabled:opacity-50"
              disabled={isBotLoading || !newMessage.trim()}
            >
              <Send className="w-5 h-5" />
            </button>
          </form>

          <div className="flex justify-center items-center space-x-6">
            <button className="bg-gray-200 w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-[#191970] hover:bg-gray-300 transition-colors">
              <Plus className="w-6 h-6" />
            </button>
            <button
              onClick={handleMicClick}
              className={`w-32 h-20 rounded-full flex items-center justify-center shadow-lg text-white transition-colors ${
                isRecording ? "bg-red-500 animate-pulse" : "bg-[#191970] hover:bg-blue-900"
              }`}
              disabled={isBotLoading}
            >
              <Mic className="w-10 h-10" />
            </button>
            <button
              onClick={stopTTS}
              className="bg-gray-200 w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-[#191970] hover:bg-gray-300 transition-colors disabled:opacity-50"
              disabled={!isPlayingTTS}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}