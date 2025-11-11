import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, X, Send, Plus, Wifi, BatteryFull, SignalHigh, Menu, ChevronLeft, MoreVertical, User, Volume2, VolumeX } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link, useLocation, useParams, useNavigate } from "react-router-dom";
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
  } catch (err) {
    console.error("❌ Erreur lors du TTS:", err);
    return null;
  }
}

/**
 * Joue un texte complet une fois le flux terminé
 */
async function speakText(text, stopFlagRef, currentAudioRef,isTTSEnabled) {

  if (!isTTSEnabled || stopFlagRef.current) return;

  if (stopFlagRef.current) return;
  const clean = cleanForSpeech(text);
  if (!clean) return;

  const audioUrl = await generateTTSWithCache(clean);
  if (!audioUrl) return;

  // 🔇 Stoppe tout son en cours
  if (currentAudioRef.current) {
    currentAudioRef.current.pause();
    currentAudioRef.current.currentTime = 0;
    currentAudioRef.current = null;
  }

  const audio = new Audio(audioUrl);
  currentAudioRef.current = audio;

  audio.addEventListener("play", () => {
    const checkStop = () => {
      if (stopFlagRef.current && !audio.paused) {
        audio.pause();
        audio.currentTime = 0;
        currentAudioRef.current = null;
      } else if (!audio.paused) {
        requestAnimationFrame(checkStop);
      }
    };
    requestAnimationFrame(checkStop);
  });

  await audio.play().catch(() => {});

}

export default function ChatStreamId() {
  // 🎯 NOUVEAU : récupère l'ID depuis l'URL
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
    // --- tout en haut de ton composant ---
const chatContainerRef = useRef(null);
const chatEndRef = useRef(null);
const [isUserNearBottom, setIsUserNearBottom] = useState(true);

  const [messages, setMessages] = useState([
    { from: "bot", text: "Bonjour 👋 Je suis la version streamée de ton assistant intelligent." },
  ]);
  const [newMessage, setNewMessage] = useState("");
  const [isBotLoading, setIsBotLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [conversations, setConversations] = useState([]);
// 🆕 NOUVEAU : État pour activer/désactiver le TTS
const [isTTSEnabled, setIsTTSEnabled] = useState(true);
  const stopFlagRef = useRef(false);
  const currentAudioRef = useRef(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const audioContextRef = useRef(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

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
      console.log("🔊 Audio déverrouillé sur iOS ✅");
    } catch (err) {
      console.error("❌ Erreur lors du déverrouillage audio:", err);
    }
  }, []);
  // 🆕 NOUVEAU : Fonction pour toggle le TTS
const toggleTTS = useCallback(() => {
  setIsTTSEnabled(prev => {
    const newState = !prev;
    console.log(newState ? "🔊 TTS activé" : "🔇 TTS désactivé");
    
    // Si on désactive, on arrête l'audio en cours
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

  // 💾 Sauvegarde un message dans Firestore
  async function saveMessage(sender, text, convId) {
    try {
      if (!convId) {
        console.error("❌ Pas d'ID de conversation pour sauvegarder");
        return;
      }

      await addDoc(collection(db, "conversations", convId, "messages"), {
        from: sender,
        text,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.error("Erreur Firestore :", error);
    }
  }

  // 📝 Met à jour le titre d'une conversation
  async function updateConversationTitle(conversationId, title) {
    try {
      const convRef = doc(db, "conversations", conversationId);
      await setDoc(convRef, { title }, { merge: true });
    } catch (error) {
      console.error("Erreur mise à jour du titre :", error);
    }
  }

  // 📖 Charge les messages d'une conversation
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
          { from: "bot", text: "Bonjour 👋 Je suis la version streamée de ton assistant intelligent." },
        ]);
      }
    } catch (error) {
      console.error("Erreur chargement messages:", error);
    }
  }

  // 📋 Charge la liste des conversations
  async function loadConversations() {
    try {
      const q = query(collection(db, "conversations"), orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      const convs = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((c) => c.title && c.title.trim() !== "");
      setConversations(convs);
    } catch (error) {
      console.error("Erreur chargement conversations:", error);
    }
  }

  // 🆕 Crée une nouvelle conversation
  async function startNewConversation() {
    try {
      const convRef = doc(collection(db, "conversations"));
      await setDoc(convRef, {
        title: "Nouvelle conversation",
        createdAt: serverTimestamp(),
      });

      console.log("✅ Nouvelle conversation créée:", convRef.id);
      
      // 🚀 Redirige vers la nouvelle conversation
      navigate(`/stream/${convRef.id}`);
      
      // Recharge la liste
      await loadConversations();
    } catch (error) {
      console.error("Erreur création conversation:", error);
    }
  }



  // 🎤 Gestion de l'enregistrement vocal
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
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());

        const formData = new FormData();
        formData.append("file", audioBlob, "audio.webm");
        formData.append("model", "whisper-large-v3");
        formData.append("language", "fr");

        try {
          const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${VITE_GROQ_API_KEY}` },
            body: formData,
          });

          if (!response.ok) throw new Error("Erreur lors de la transcription");

          // const data = await response.json();
          // const transcribedText = data.text || "";
          // setNewMessage(transcribedText);


          const data = await response.json();
const transcribedText = data.text?.trim();

if (transcribedText) {
  console.log("🎤 Transcription terminée :", transcribedText);
  await handleStreamCall(transcribedText); // envoi direct au LLM
} else {
  console.warn("⚠️ Aucune transcription détectée.");
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

  // 🖼️ Gestion de l'upload d'image
  const handleImageUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setSelectedImage(reader.result);
    reader.readAsDataURL(file);
  }, []);

  const handleWebSearch = useCallback(async () => {
    const query = newMessage.trim();
    if (!query) return;
  
    stopFlagRef.current = false;
    addMessage(query, "user");
    await saveMessage("user", query, conversationId);
    setNewMessage("");
    setIsBotLoading(true);
  
    try {
      // 1️⃣ Effectue la recherche web
      const resp = await fetch(`${API_URL}/api/ollama-web-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
  
      if (!resp.ok) throw new Error("Erreur HTTP Ollama Web Search");
      const data = await resp.json();
  
      if (data.results?.length) {
        // 2️⃣ Prépare le contexte pour le LLM
        const searchContext = data.results
          .map((r, idx) => 
            `[${idx + 1}] ${r.title}\n${r.snippet || r.content || ""}\nSource: ${r.url}`
          )
          .join("\n\n");
  
        // 3️⃣ Construit l'historique avec le contexte de recherche
        const history = messages.map((m) => ({
          role: m.from === "user" ? "user" : "assistant",
          content: m.text,
        }));
  
        history.push({
          role: "user",
          content: `Voici les résultats de recherche pour "${query}":\n\n${searchContext}\n\nPeux-tu me faire une synthèse claire et structurée en français de ces informations ?`,
        });
  
        // 4️⃣ Envoie au LLM pour traitement
        const llmResponse = await fetch(`${API_URL}/api/qwen-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });
  
        if (!llmResponse.ok) throw new Error(`Erreur LLM: ${llmResponse.status}`);
  
        // 5️⃣ Stream la réponse du LLM
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
            updated[updated.length - 1] = { from: "bot", text: accumulatedText };
            return updated;
          });
        }
  
        // 6️⃣ Sauvegarde et lecture vocale
        await saveMessage("bot", accumulatedText, conversationId);
        await speakText(accumulatedText, stopFlagRef, currentAudioRef, isTTSEnabled);
  
      } else {
        const noResult = "Aucun résultat trouvé pour cette recherche 🧐";
        addMessage(noResult, "bot");
        await saveMessage("bot", noResult, conversationId);
      }
    } catch (error) {
      console.error("❌ Erreur Web Search:", error);
      addMessage("Erreur lors de la recherche web.", "bot");
    } finally {
      setIsBotLoading(false);
    }
  }, [newMessage, conversationId, addMessage, messages, isTTSEnabled]);

  // 📤 Gestion de l'envoi de message
  const handleStreamCall = useCallback(
    async (userMessage) => {
      if (!conversationId) {
        console.error("❌ Pas d'ID de conversation active");
        return;
      }

      const messageToSend = userMessage.trim();
      if (!messageToSend && !selectedImage) return;

      stopFlagRef.current = false;

      // Ajoute le message utilisateur
      addMessage(messageToSend, "user");
      await saveMessage("user", messageToSend, conversationId);

      // Met à jour le titre si c'est le premier message
      const firstUserMessage = messages.filter(m => m.from === "user").length === 0;
      if (firstUserMessage) {
        const shortTitle = messageToSend.slice(0, 40) || "Nouvelle conversation";
        await updateConversationTitle(conversationId, shortTitle);
        await loadConversations();
      }

      setIsBotLoading(true);
      const history = messages.map((m) => ({
        role: m.from === "user" ? "user" : "assistant",
        content: m.text,
      }));
      history.push({ role: "user", content: messageToSend });
      
      const requestBody = selectedImage
        ? { messages: history, image: selectedImage }
        : { messages: history };
      

      if (selectedImage) {
        requestBody.image = selectedImage;
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

        // Sauvegarde la réponse complète
        await saveMessage("bot", accumulatedText, conversationId);

        // Lecture vocale
        await speakText(accumulatedText, stopFlagRef, currentAudioRef,isTTSEnabled);
      } catch (error) {
        console.error("❌ Erreur streaming:", error);
        addMessage("Erreur lors de la récupération de la réponse.", "bot");
      } finally {
        setIsBotLoading(false);
      }
    },
    [conversationId, messages, addMessage, selectedImage, isTTSEnabled]

  );


  // 📏 Vérifie si l'utilisateur est proche du bas
const handleScroll = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
  
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
  
    // Si l'utilisateur est à moins de 150px du bas, on considère qu'il "suit" la conversation
    setIsUserNearBottom(distanceFromBottom < 150);
  }, []);
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
  
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);
  
  // Quand un nouveau message arrive…
  useEffect(() => {
    if (isUserNearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isUserNearBottom]);
    



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

  const stopTTS = useCallback(() => {
    stopFlagRef.current = true;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
  }, []);

  const handlePasteInInput = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();

        reader.onload = () => {
          const imageData = reader.result;
          setSelectedImage(imageData);
        };

        reader.readAsDataURL(blob);
        return;
      }
    }
  }, []);

  // 🎯 EFFET PRINCIPAL : Charge les conversations au montage
  useEffect(() => {
    loadConversations();
  }, []);

  // 🎯 EFFET : Charge les messages quand l'ID change
  useEffect(() => {
    if (conversationId) {
      console.log("📂 Chargement de la conversation:", conversationId);
      loadMessages(conversationId);
    } else {
      // Si pas d'ID dans l'URL, on est sur /stream → conversation vide
      setMessages([
        { from: "bot", text: "Bonjour 👋 Je suis la version streamée de ton assistant intelligent." },
      ]);
    }
  }, [conversationId]);

  const [searchTerm, setSearchTerm] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isFullMenuOpen, setIsFullMenuOpen] = useState(false);


const filteredConversations = conversations.filter(conv =>
    conv.title && conv.title.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  
  const handleSearch = () => {
    if (!searchTerm.trim()) {
      setFilteredConversations(conversations);
      return;
    }
    const lower = searchTerm.toLowerCase();
    const filtered = conversations.filter(conv =>
      conv.title && conv.title.toLowerCase().includes(lower)
    );
    setFilteredConversations(filtered);
  };
  
  



  return (
    <div className="bg-white text-[#191970] min-h-screen font-[Cinzel] flex flex-col">
      <div className="container mx-auto px-4 pt-6 flex flex-col flex-grow">
        {/* Header */}
        <header className="fixed top-0 left-0 w-full bg-white border-b shadow-sm z-50">
  <div className="container mx-auto px-4 py-3 flex justify-between items-center">
    {/* 🔘 Bouton toggle gauche (sidebar) */}
    <div className="flex items-center gap-3">
      <button
        onClick={() => setIsSidebarOpen((prev) => !prev)}
        className="bg-gray-200 hover:bg-gray-300 text-[#191970] rounded-full p-2 shadow transition"
        title={isSidebarOpen ? "Masquer la barre latérale" : "Afficher la barre latérale"}
      >
        {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      <h1 className="text-lg font-semibold text-[#191970]">
        Assistant Vocal Intelligent
      </h1>
    </div>


    {/* ⚙️ Menu à droite */}
    <div className="flex items-center gap-3">
      <div className="hidden sm:flex items-center space-x-2 text-sm text-[#191970]">
        <SignalHigh className="w-4 h-4" />
        <Wifi className="w-4 h-4" />
        <span>77%</span>
        <BatteryFull className="w-4 h-4" />
      </div>

      {/* bouton menu utilisateur */}
      <button
  onClick={() => setIsFullMenuOpen(true)}
  className="bg-gray-200 hover:bg-gray-300 text-[#191970] rounded-full p-2 shadow transition"
  title="Ouvrir le menu principal"
>
  <MoreVertical className="w-5 h-5" />
</button>

    </div>
  </div>
</header>
{isFullMenuOpen && (
  <div className="fixed inset-0 bg-white bg-opacity-95 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center animate-fadeIn">
    {/* Bouton fermer */}
    <button
      onClick={() => setIsFullMenuOpen(false)}
      className="absolute top-6 right-6 text-[#191970] hover:text-blue-900 transition text-3xl font-bold"
      title="Fermer le menu"
    >
      ✖️
    </button>

    {/* Liens du menu */}
    <nav className="flex flex-col items-center space-y-8 text-2xl text-[#191970] font-semibold">
      <Link
        to="/"
        onClick={() => setIsFullMenuOpen(false)}
        className="hover:text-blue-700 transition"
      >
        💬 Chat
      </Link>
      <Link
        to="/stream"
        onClick={() => setIsFullMenuOpen(false)}
        className="hover:text-blue-700 transition"
      >
        ⚡ Stream
      </Link>
      <Link
        to="/voice"
        onClick={() => setIsFullMenuOpen(false)}
        className="hover:text-blue-700 transition"
      >
        🎙️ Vocal
      </Link>

      <div className="w-16 h-[2px] bg-[#191970] my-4" />

      <Link
        to="/parametres"
        onClick={() => setIsFullMenuOpen(false)}
        className="hover:text-blue-700 transition"
      >
        ⚙️ Paramètres
      </Link>
      <Link
        to="/profil"
        onClick={() => setIsFullMenuOpen(false)}
        className="hover:text-blue-700 transition"
      >
        👤 Profil
      </Link>
      <Link
        to="/aide"
        onClick={() => setIsFullMenuOpen(false)}
        className="hover:text-blue-700 transition"
      >
        ❓ Aide
      </Link>
    </nav>
  </div>
)}



        {/* 💬 Contenu principal : Sidebar + Chat */}
        <div className="flex h-[calc(100vh-60px)] mt-[60px]">
  {/* 🧭 Sidebar gauche */}
  <aside
    className={`fixed top-[60px] left-0 h-[calc(100vh-60px)] bg-gray-50 border-r border-gray-200 p-4 flex-col transition-all duration-300 ease-in-out
      ${isSidebarOpen ? "w-64 opacity-100" : "w-0 opacity-0 overflow-hidden"}`}
  >
    <button
      onClick={startNewConversation}
      className="mb-4 bg-blue-500 text-white py-2 rounded-lg shadow hover:bg-blue-600 transition"
    >
      + Nouvelle conversation
    </button>
      {/* bouton toggle */}
      
    <input
      type="text"
      placeholder="Rechercher une conversation..."
      className="w-full p-2 rounded-md border border-gray-300 focus:outline-none focus:ring"
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
    />

    <div className="overflow-y-auto flex-1 mt-3">
      {filteredConversations.map((conv) => (
        <Link
          key={conv.id}
          to={`/stream/${conv.id}`}
          className={`block p-2 mb-2 rounded-lg cursor-pointer ${
            conv.id === conversationId
              ? "bg-blue-100 border-l-4 border-blue-500"
              : "hover:bg-gray-100"
          }`}
        >
          <p className="text-sm text-gray-800 truncate">{conv.title || "Sans titre"}</p>
        </Link>
      ))}
    </div>
  </aside>
{/* 🧠 Zone du chat - CORRECTION */}
<section
  ref={chatContainerRef}  // 👈 Ajoute la ref ici
  className={`flex-1 flex flex-col bg-white transition-all duration-300 ${
    isSidebarOpen ? "ml-64" : "ml-0"
  }`}
  style={{ height: 'calc(100vh - 60px)' }} // 👈 Hauteur fixe
>
  {/* contenu du chat */}
  <main className="flex-grow overflow-y-auto space-y-4 text-lg p-6">
    {messages.map((msg, idx) => (
      <div
        key={idx}
        className={`p-4 rounded-xl max-w-[85%] border shadow-sm ${
          msg.from === "user"
            ? "ml-auto bg-[#191970] text-white"
            : "mr-auto bg-gray-100 text-[#191970]"
        }`}
      >
        <div className="markdown-container">
          <ReactMarkdown>{msg.text}</ReactMarkdown>
        </div>
      </div>
    ))}
    <div ref={chatEndRef} />
  </main>


</section>
</div>
  {/* Footer - CORRECTION */}
  <footer className="w-full py-4 bg-white border-t shadow-lg">
    {selectedImage && (
      <div className="mb-4 flex justify-center px-4">
        <div className="relative inline-block">
          <img
            src={selectedImage}
            alt="Prévisualisation"
            className="w-40 h-auto rounded-xl border shadow-md"
          />
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-1 right-1 bg-black bg-opacity-60 text-white rounded-full p-1 hover:bg-opacity-80"
            title="Supprimer l'image"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    )}

    <div className="flex justify-center h-[100px] items-center space-x-6 px-4">
      <label className="bg-gray-200 w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-[#191970] hover:bg-gray-300 cursor-pointer">
        <Plus className="w-6 h-6" />
        <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
      </label>

      <button
        onClick={handleMicClick}
        className={`w-32 h-20 rounded-full flex items-center justify-center shadow-lg text-white transition-colors ${
          isRecording ? "bg-red-500 animate-pulse" : "bg-[#191970] hover:bg-blue-900"
        }`}
      >
        <Mic className="w-10 h-10" />
      </button>

      <button
        onClick={toggleTTS}
        className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors ${
          isTTSEnabled 
            ? "bg-[#191970] text-white hover:bg-blue-900" 
            : "bg-gray-300 text-gray-600 hover:bg-gray-400"
        }`}
        title={isTTSEnabled ? "Désactiver le text-to-speech" : "Activer le text-to-speech"}
      >
        {isTTSEnabled ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
      </button>

      <button
        onClick={stopTTS}
        className="bg-gray-200 w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-[#191970] hover:bg-gray-300"
        title="Arrêter la lecture en cours"
      >
        <X className="w-6 h-6" />
      </button>
    </div>

    <form onSubmit={handleSend} className="flex items-center gap-2 px-4">
      <input
        type="text"
        value={newMessage}
        onChange={(e) => setNewMessage(e.target.value)}
        onPaste={handlePasteInInput}
        placeholder="Parle ou écris un message..."
        className="flex-grow border border-gray-400 rounded-lg px-3 py-2 bg-white text-[#191970] focus:outline-none focus:ring-2 focus:ring-[#191970]"
      />
      
      <button
  type="button"
  onClick={(e) => {
    e.preventDefault();
    e.stopPropagation();
    handleWebSearch();
  }}
  className="relative z-20 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  title="Recherche sur le Web via Ollama"
>
  {isBotLoading ? "⏳" : "🌐"} Web
</button>
      
      <button
        type="submit"
        className="bg-[#191970] text-white px-4 py-2 rounded-lg hover:bg-blue-900 transition-colors disabled:opacity-50"
        disabled={isBotLoading}
      >
        <Send className="w-5 h-5" />
      </button>
    </form>
  </footer>


        {!audioUnlocked && (
          <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
            <p className="text-lg text-[#191970] mb-4 text-center">
              🔊 Active le son pour entendre la voix de l'assistant
            </p>
            <button
              onClick={handleUnlockAudio}
              className="px-6 py-3 bg-[#191970] text-white rounded-full shadow-lg hover:bg-blue-900 transition-transform hover:scale-105"
            >
              Activer le son
            </button>
          </div>
        )}

        {/* Image sélectionnée */}
        {selectedImage && (
          <div className="flex justify-end mb-4">
            <div className="relative">
              <img
                src={selectedImage}
                alt="image"
                className="w-48 h-auto rounded-lg shadow-md border"
              />
              <button
                onClick={() => setSelectedImage(null)}
                className="absolute top-1 right-1 bg-black bg-opacity-50 text-white rounded-full p-1"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

     
      </div>
    </div>
  );
}