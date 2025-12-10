import { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic,
  X,
  Send,
  Plus,
  Wifi,
  BatteryFull,
  SignalHigh,
  Menu,
  ChevronLeft,
  MoreVertical,
  Volume2,
  VolumeX,
  MessageSquare,
  Zap,
  Mic2,
  Settings,
  User,
  HelpCircle,
  Search,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link, useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  doc,
  setDoc,
} from "firebase/firestore";

// --- Constantes ---
const MAX_CACHE_SIZE = 50;
const VITE_GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const API_URL = "https://openaiturbo.onrender.com";

// --- Cache pour le TTS ---
const ttsCache = new Map();

/**
 * Nettoie le texte avant de le lire
 */
function cleanForSpeech(text) {
  return text
    .replace(/[*_`#>~\-]+/g, "")
    .replace(
      /([\u2700-\u27BF]|[\uE000-\uF8FF]|[\uD83C-\uDBFF\uDC00-\uDFFF]|[\uFE0F])/g,
      ""
    )
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[•·→←↔️◾◽◆◇◉◎○●]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Génère ou récupère l'audio TTS depuis le cache
 */
async function generateTTSWithCache(sentence, voice = "fr-FR-DeniseNeural") {
  const cacheKey = `${voice}_${sentence}`;
  if (ttsCache.has(cacheKey)) return ttsCache.get(cacheKey);

  try {
    const response = await fetch(
      "https://seo-tool-cd8x.onrender.com/synthesize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence, voice }),
      }
    );

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
  } catch (err) {
    console.error("❌ Erreur lors du TTS:", err);
    return null;
  }
}

function splitIntoSentences(text) {
  return text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) || [text];
}

async function speakTextBySentence(
  fullText,
  stopFlagRef,
  currentAudioRef,
  isTTSEnabled
) {
  if (!isTTSEnabled || stopFlagRef.current) return;

  const clean = cleanForSpeech(fullText);
  if (!clean) return;

  const sentences = splitIntoSentences(clean);

  for (const sentence of sentences) {
    if (stopFlagRef.current) return;

    const audioUrl = await generateTTSWithCache(sentence);
    if (!audioUrl) continue;

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }

    const audio = new Audio(audioUrl);
    currentAudioRef.current = audio;

    await new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = resolve;

      const checkStop = () => {
        if (stopFlagRef.current) {
          audio.pause();
          audio.currentTime = 0;
          currentAudioRef.current = null;
          resolve();
        } else if (!audio.paused) {
          requestAnimationFrame(checkStop);
        }
      };

      audio.addEventListener("play", () => requestAnimationFrame(checkStop));
      audio.play().catch(resolve);
    });
  }
}

// ============================================
// COMPOSANT PRINCIPAL
// ============================================
export default function ChatStreamId() {
  const { conversationId } = useParams();
  const navigate = useNavigate();

  // Refs
  const chatContainerRef = useRef(null);
  const chatEndRef = useRef(null);
  const stopFlagRef = useRef(false);
  const currentAudioRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // États
  const [messages, setMessages] = useState([
    {
      from: "bot",
      text: "Bonjour 👋 Je suis ton assistant intelligent. Comment puis-je t'aider aujourd'hui ?",
    },
  ]);
  const [newMessage, setNewMessage] = useState("");
  const [isBotLoading, setIsBotLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [isTTSEnabled, setIsTTSEnabled] = useState(true);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [isUserNearBottom, setIsUserNearBottom] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Fermé par défaut sur mobile
  const [isFullMenuOpen, setIsFullMenuOpen] = useState(false);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);

  // ============================================
  // FONCTIONS UTILITAIRES
  // ============================================

  const addMessage = useCallback((text, from) => {
    setMessages((prev) => [...prev, { from, text }]);
  }, []);

  const handleUnlockAudio = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        alert("Ton navigateur ne supporte pas Web Audio API.");
        return;
      }

      const ctx = new AudioContext();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
      ctx.resume();

      audioContextRef.current = ctx;
      setAudioUnlocked(true);
    } catch (err) {
      console.error("❌ Erreur lors du déverrouillage audio:", err);
    }
  }, []);

  const toggleTTS = useCallback(() => {
    setIsTTSEnabled((prev) => {
      const newState = !prev;
      if (!newState && currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current = null;
        stopFlagRef.current = true;
      } else if (newState) {
        stopFlagRef.current = false;
      }
      return newState;
    });
  }, []);

  const stopTTS = useCallback(() => {
    stopFlagRef.current = true;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
  }, []);

  // ============================================
  // FIREBASE FUNCTIONS
  // ============================================

  async function saveMessage(sender, text, convId) {
    try {
      if (!convId) return;
      await addDoc(collection(db, "conversations", convId, "messages"), {
        from: sender,
        text,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.error("Erreur Firestore :", error);
    }
  }

  async function updateConversationTitle(conversationId, title) {
    try {
      const convRef = doc(db, "conversations", conversationId);
      await setDoc(convRef, { title }, { merge: true });
    } catch (error) {
      console.error("Erreur mise à jour du titre :", error);
    }
  }

  async function loadMessages(convId) {
    if (!convId) return;

    try {
      const q = query(
        collection(db, "conversations", convId, "messages"),
        orderBy("timestamp")
      );
      const snapshot = await getDocs(q);
      const loadedMessages = snapshot.docs.map((doc) => doc.data());

      if (loadedMessages.length > 0) {
        setMessages(loadedMessages);
      } else {
        setMessages([
          {
            from: "bot",
            text: "Bonjour 👋 Je suis ton assistant intelligent. Comment puis-je t'aider aujourd'hui ?",
          },
        ]);
      }
    } catch (error) {
      console.error("Erreur chargement messages:", error);
    }
  }

  async function loadConversations() {
    try {
      const q = query(
        collection(db, "conversations"),
        orderBy("createdAt", "desc")
      );
      const snapshot = await getDocs(q);
      const convs = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((c) => c.title && c.title.trim() !== "");
      setConversations(convs);
    } catch (error) {
      console.error("Erreur chargement conversations:", error);
    }
  }

  async function startNewConversation() {
    try {
      const convRef = doc(collection(db, "conversations"));
      await setDoc(convRef, {
        title: "Nouvelle conversation",
        createdAt: serverTimestamp(),
      });
      navigate(`/stream/${convRef.id}`);
      await loadConversations();
      setIsSidebarOpen(false); // Ferme la sidebar sur mobile après création
    } catch (error) {
      console.error("Erreur création conversation:", error);
    }
  }

  // ============================================
  // HANDLERS
  // ============================================

  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());

        const formData = new FormData();
        formData.append("file", audioBlob, "audio.webm");
        formData.append("model", "whisper-large-v3");
        formData.append("language", "fr");

        try {
          const response = await fetch(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${VITE_GROQ_API_KEY}` },
              body: formData,
            }
          );

          if (!response.ok) throw new Error("Erreur lors de la transcription");

          const data = await response.json();
          const transcribedText = data.text?.trim();

          if (transcribedText) {
            await handleStreamCall(transcribedText);
          }
        } catch (error) {
          console.error("Erreur transcription:", error);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Erreur micro:", error);
      alert("Impossible d'accéder au microphone.");
    }
  }, [isRecording]);

  const handleImageUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setSelectedImage(reader.result);
    reader.readAsDataURL(file);
  }, []);

  const handlePasteInInput = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = () => setSelectedImage(reader.result);
        reader.readAsDataURL(blob);
        return;
      }
    }
  }, []);

  const handleStreamCall = useCallback(
    async (userMessage) => {
      if (!conversationId) {
        console.error("❌ Pas d'ID de conversation active");
        return;
      }

      const messageToSend = userMessage.trim();
      if (!messageToSend && !selectedImage) return;

      stopFlagRef.current = false;

      addMessage(messageToSend, "user");
      await saveMessage("user", messageToSend, conversationId);

      const firstUserMessage =
        messages.filter((m) => m.from === "user").length === 0;
      if (firstUserMessage) {
        const shortTitle =
          messageToSend.slice(0, 40) || "Nouvelle conversation";
        await updateConversationTitle(conversationId, shortTitle);
        await loadConversations();
      }

      setIsBotLoading(true);

      // 🔍 RECHERCHE WEB
      if (isWebSearchEnabled) {
        try {
          const resp = await fetch(`${API_URL}/api/ollama-web-search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: messageToSend }),
          });

          if (!resp.ok) throw new Error("Erreur HTTP Ollama Web Search");
          const data = await resp.json();

          if (data.results?.length) {
            const searchContext = data.results
              .map(
                (r, idx) =>
                  `[${idx + 1}] ${r.title}\n${r.snippet || r.content || ""}\nSource: ${r.url}`
              )
              .join("\n\n");

            const history = messages.map((m) => ({
              role: m.from === "user" ? "user" : "assistant",
              content: m.text,
            }));

            history.push({
              role: "user",
              content: `Voici les résultats de recherche pour "${messageToSend}":\n\n${searchContext}\n\nPeux-tu me faire une synthèse claire et structurée en français de ces informations ?`,
            });

            const llmResponse = await fetch(`${API_URL}/api/qwen-stream`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: history }),
            });

            if (!llmResponse.ok)
              throw new Error(`Erreur LLM: ${llmResponse.status}`);

            const reader = llmResponse.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let accumulatedText = "";

            addMessage("", "bot");

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              accumulatedText += chunk;

              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  from: "bot",
                  text: accumulatedText,
                };
                return updated;
              });
            }

            await saveMessage("bot", accumulatedText, conversationId);
            await speakTextBySentence(
              accumulatedText,
              stopFlagRef,
              currentAudioRef,
              isTTSEnabled
            );
          } else {
            const noResult = "Aucun résultat trouvé 🧐";
            addMessage(noResult, "bot");
            await saveMessage("bot", noResult, conversationId);
          }
        } catch (error) {
          console.error("❌ Erreur Web Search:", error);
          addMessage("Erreur lors de la recherche web.", "bot");
        } finally {
          setIsBotLoading(false);
        }
        return;
      }

      // ⚡ ENVOI NORMAL
      const history = messages.map((m) => ({
        role: m.from === "user" ? "user" : "assistant",
        content: m.text,
      }));
      history.push({ role: "user", content: messageToSend });

      const requestBody = selectedImage
        ? { messages: history, image: selectedImage }
        : { messages: history };

      if (selectedImage) {
        setSelectedImage(null);
      }

      try {
        const response = await fetch(`${API_URL}/api/qwen-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let accumulatedText = "";

        addMessage("", "bot");

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          accumulatedText += chunk;

          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { from: "bot", text: accumulatedText };
            return updated;
          });
        }

        await saveMessage("bot", accumulatedText, conversationId);
        await speakTextBySentence(
          accumulatedText,
          stopFlagRef,
          currentAudioRef,
          isTTSEnabled
        );
      } catch (error) {
        console.error("❌ Erreur streaming:", error);
        addMessage("Erreur lors de la récupération de la réponse.", "bot");
      } finally {
        setIsBotLoading(false);
      }
    },
    [
      conversationId,
      messages,
      addMessage,
      selectedImage,
      isTTSEnabled,
      isWebSearchEnabled,
    ]
  );

  const handleSend = useCallback(
    (e) => {
      e.preventDefault();
      if (!newMessage.trim() && !selectedImage) return;
      if (isBotLoading) return;

      handleStreamCall(newMessage);
      setNewMessage("");
    },
    [newMessage, isBotLoading, handleStreamCall, selectedImage]
  );

  // ============================================
  // EFFECTS
  // ============================================

  const handleScroll = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsUserNearBottom(distanceFromBottom < 150);
  }, []);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (isUserNearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isUserNearBottom]);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (conversationId) {
      loadMessages(conversationId);
    } else {
      setMessages([
        {
          from: "bot",
          text: "Bonjour 👋 Je suis ton assistant intelligent. Comment puis-je t'aider aujourd'hui ?",
        },
      ]);
    }
  }, [conversationId]);

  // Responsive : ouvrir la sidebar par défaut sur desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ============================================
  // DONNÉES FILTRÉES
  // ============================================

  const filteredConversations = conversations.filter(
    (conv) =>
      conv.title && conv.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ============================================
  // RENDER
  // ============================================

  // Écran de déverrouillage audio (iOS)
  if (!audioUnlocked) {
    return (
      <div className="fixed inset-0 bg-[#191970] flex flex-col items-center justify-center z-50">
        <div className="text-center px-6">
          <div className="w-24 h-24 mx-auto mb-6 bg-white/10 rounded-full flex items-center justify-center">
            <Volume2 className="w-12 h-12 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">
            Activer le son
          </h2>
          <p className="text-white/70 mb-8 max-w-xs mx-auto">
            Pour profiter de l'assistant vocal, active le son de ton appareil
          </p>
          <button
            onClick={handleUnlockAudio}
            className="px-8 py-4 bg-white text-[#191970] font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95"
          >
            Activer le son 🔊
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* ============================================ */}
      {/* HEADER */}
      {/* ============================================ */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0 z-40">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {isSidebarOpen ? (
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            ) : (
              <Menu className="w-5 h-5 text-gray-600" />
            )}
          </button>
          <h1 className="text-lg font-semibold text-gray-800 hidden sm:block">
            Assistant Intelligent
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500 mr-2">
            <SignalHigh className="w-4 h-4" />
            <Wifi className="w-4 h-4" />
            <span>77%</span>
            <BatteryFull className="w-4 h-4" />
          </div>
          <button
            onClick={() => setIsFullMenuOpen(true)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <MoreVertical className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </header>

      {/* ============================================ */}
      {/* MAIN CONTAINER */}
      {/* ============================================ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ============================================ */}
        {/* SIDEBAR */}
        {/* ============================================ */}
        {/* Overlay mobile */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed md:relative z-40 md:z-auto
            h-[calc(100vh-56px)] w-72 bg-white border-r border-gray-200
            flex flex-col
            transition-transform duration-300 ease-in-out
            ${isSidebarOpen ? "translate-x-0" : "-translate-x-full md:hidden"}
          `}
        >
          {/* Bouton nouvelle conversation */}
          <div className="p-4 border-b border-gray-100">
            <button
              onClick={startNewConversation}
              className="w-full py-3 bg-[#191970] text-white font-medium rounded-xl shadow-md hover:shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] hover:bg-[#252580] flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Nouvelle conversation
            </button>
          </div>

          {/* Recherche */}
          <div className="px-4 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                className="w-full pl-10 pr-4 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#191970]/50 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Liste des conversations */}
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {filteredConversations.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">
                Aucune conversation
              </p>
            ) : (
              filteredConversations.map((conv) => (
                <Link
                  key={conv.id}
                  to={`/stream/${conv.id}`}
                  onClick={() => {
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={`
                    block px-4 py-3 mb-1 rounded-xl transition-all
                    ${
                      conv.id === conversationId
                        ? "bg-[#191970]/10 border-l-4 border-[#191970]"
                        : "hover:bg-gray-50"
                    }
                  `}
                >
                  <p className="text-sm text-gray-700 truncate font-medium">
                    {conv.title || "Sans titre"}
                  </p>
                </Link>
              ))
            )}
          </div>
        </aside>

        {/* ============================================ */}
        {/* ZONE CHAT */}
        {/* ============================================ */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto px-4 py-6"
          >
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`
                      max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm
                      ${
                        msg.from === "user"
                          ? "bg-[#191970] text-white"
                          : "bg-white text-gray-800 border border-gray-100"
                      }
                    `}
                  >
                    {/* Markdown avec styles personnalisés */}
                    <div
                      className={`
                        prose prose-sm max-w-none
                        ${msg.from === "user" ? "prose-invert" : ""}
                        [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-[#191970]
                        [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-[#191970]
                        [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-2 [&_h3]:text-[#191970]/80
                        [&_p]:mb-2 [&_p]:leading-relaxed
                        [&_ul]:my-2 [&_ul]:pl-4 [&_ul]:space-y-1
                        [&_ol]:my-2 [&_ol]:pl-4 [&_ol]:space-y-1
                        [&_li]:text-sm
                        [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_code]:text-pink-600
                        [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:my-3
                        [&_pre_code]:bg-transparent [&_pre_code]:text-gray-100 [&_pre_code]:p-0
                        [&_blockquote]:border-l-4 [&_blockquote]:border-[#191970] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_blockquote]:my-3
                        [&_a]:text-[#191970] [&_a]:underline [&_a]:hover:text-[#252580]
                        [&_strong]:font-semibold
                        [&_em]:italic
                        [&_hr]:my-4 [&_hr]:border-gray-200
                        [&_table]:w-full [&_table]:border-collapse [&_table]:my-3
                        [&_th]:bg-gray-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_th]:border [&_th]:border-gray-200
                        [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_td]:border [&_td]:border-gray-200
                        ${msg.from === "user" ? "[&_code]:bg-white/20 [&_code]:text-white" : ""}
                      `}
                    >
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}

              {/* Indicateur de chargement */}
              {isBotLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 bg-[#191970] rounded-full animate-bounce" />
                      <span
                        className="w-2 h-2 bg-[#191970] rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      />
                      <span
                        className="w-2 h-2 bg-[#191970] rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>

          {/* ============================================ */}
          {/* FOOTER / INPUT */}
          {/* ============================================ */}
          <div className="border-t border-gray-200 bg-white px-4 py-4 flex-shrink-0">
            <div className="max-w-3xl mx-auto">
              {/* Image preview */}
              {selectedImage && (
                <div className="mb-3 flex justify-start">
                  <div className="relative inline-block">
                    <img
                      src={selectedImage}
                      alt="Prévisualisation"
                      className="h-20 w-auto rounded-xl border border-gray-200 shadow-sm"
                    />
                    <button
                      onClick={() => setSelectedImage(null)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              {/* Options */}
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isWebSearchEnabled}
                    onChange={(e) => setIsWebSearchEnabled(e.target.checked)}
                    className="w-4 h-4 accent-[#191970] rounded cursor-pointer"
                  />
                  <span className="text-sm text-gray-600 font-medium">
                    🌐 Recherche web
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleTTS}
                    className={`p-2 rounded-lg transition-colors ${
                      isTTSEnabled
                        ? "bg-[#191970]/10 text-[#191970]"
                        : "bg-gray-100 text-gray-400"
                    }`}
                    title={isTTSEnabled ? "Désactiver TTS" : "Activer TTS"}
                  >
                    {isTTSEnabled ? (
                      <Volume2 className="w-5 h-5" />
                    ) : (
                      <VolumeX className="w-5 h-5" />
                    )}
                  </button>
                  <button
                    onClick={stopTTS}
                    className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                    title="Arrêter la lecture"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Input zone */}
              <form onSubmit={handleSend} className="flex items-end gap-3">
                {/* Upload image */}
                <label className="p-3 bg-gray-100 hover:bg-gray-200 rounded-xl cursor-pointer transition-colors flex-shrink-0">
                  <Plus className="w-5 h-5 text-gray-600" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </label>

                {/* Text input */}
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onPaste={handlePasteInInput}
                    placeholder="Écris ton message..."
                    className="w-full px-4 py-3 bg-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#191970]/50 transition-all pr-12"
                  />
                </div>

                {/* Mic button */}
                <button
                  type="button"
                  onClick={handleMicClick}
                  className={`p-3 rounded-xl transition-all flex-shrink-0 ${
                    isRecording
                      ? "bg-red-500 text-white animate-pulse"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                  }`}
                >
                  <Mic className="w-5 h-5" />
                </button>

                {/* Send button */}
                <button
                  type="submit"
                  disabled={isBotLoading || (!newMessage.trim() && !selectedImage)}
                  className="p-3 bg-[#191970] text-white rounded-xl hover:bg-[#252580] hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </div>
        </main>
      </div>

      {/* ============================================ */}
      {/* MENU PLEIN ÉCRAN */}
      {/* ============================================ */}
      {isFullMenuOpen && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col animate-in fade-in duration-200">
          <div className="flex justify-end p-4">
            <button
              onClick={() => setIsFullMenuOpen(false)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-6 h-6 text-gray-600" />
            </button>
          </div>

          <nav className="flex-1 flex flex-col items-center justify-center gap-6">
            <Link
              to="/"
              onClick={() => setIsFullMenuOpen(false)}
              className="flex items-center gap-3 text-xl text-gray-700 hover:text-[#191970] transition-colors"
            >
              <MessageSquare className="w-6 h-6" />
              Chat
            </Link>
            <Link
              to="/stream"
              onClick={() => setIsFullMenuOpen(false)}
              className="flex items-center gap-3 text-xl text-gray-700 hover:text-[#191970] transition-colors"
            >
              <Zap className="w-6 h-6" />
              Stream
            </Link>
            <Link
              to="/voice"
              onClick={() => setIsFullMenuOpen(false)}
              className="flex items-center gap-3 text-xl text-gray-700 hover:text-[#191970] transition-colors"
            >
              <Mic2 className="w-6 h-6" />
              Vocal
            </Link>

            <div className="w-16 h-px bg-gray-200 my-4" />

            <Link
              to="/parametres"
              onClick={() => setIsFullMenuOpen(false)}
              className="flex items-center gap-3 text-xl text-gray-700 hover:text-[#191970] transition-colors"
            >
              <Settings className="w-6 h-6" />
              Paramètres
            </Link>
            <Link
              to="/profil"
              onClick={() => setIsFullMenuOpen(false)}
              className="flex items-center gap-3 text-xl text-gray-700 hover:text-[#191970] transition-colors"
            >
              <User className="w-6 h-6" />
              Profil
            </Link>
            <Link
              to="/aide"
              onClick={() => setIsFullMenuOpen(false)}
              className="flex items-center gap-3 text-xl text-gray-700 hover:text-[#191970] transition-colors"
            >
              <HelpCircle className="w-6 h-6" />
              Aide
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}