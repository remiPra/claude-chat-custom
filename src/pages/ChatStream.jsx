import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, X, Send, Plus, Wifi, BatteryFull, SignalHigh } from "lucide-react";
import ReactMarkdown from "react-markdown";
// import { Link } from "react-router-dom";
import { Link, useLocation } from "react-router-dom";
import { useNavigate } from "react-router-dom";

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
const VITE_GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY; // Pour Whisper
const API_URL = "https://openaiturbo.onrender.com"; // ton serveur Node local

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
 * Génère ou récupère l’audio TTS depuis le cache
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
async function speakText(text, stopFlagRef, currentAudioRef) {
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

  // Si stopFlag change pendant la lecture → stoppe aussi
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


export default function ChatStream() {
  const [messages, setMessages] = useState([
    { from: "bot", text: "Bonjour 👋 Je suis la version streamée de ton assistant intelligent." },
  ]);
  const [newMessage, setNewMessage] = useState("");
  const [isBotLoading, setIsBotLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [conversations, setConversations] = useState([]); // liste à gauche
  const [currentConversationId, setCurrentConversationId] = useState(null);
  
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
  
      // Crée un contexte audio et joue un son vide
      const ctx = new AudioContext();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
      ctx.resume();
  
      // Sauvegarde le contexte et active le son
      audioContextRef.current = ctx;
      setAudioUnlocked(true);
      console.log("🔊 Audio déverrouillé sur iOS ✅");
    } catch (err) {
      console.error("❌ Erreur lors du déverrouillage audio:", err);
    }
  }, []);

//   // 🧠 Correction : exécution unique
// useEffect(() => {
//   if (!currentConversationId) {
//     startNewConversation();
//   }
//   // ⛔ on ne met PAS conversations dans les dépendances
//   // eslint-disable-next-line react-hooks/exhaustive-deps
// }, []);



async function saveMessage(sender, text) {
  try {
    let convId = currentConversationIdRef.current;

    // 🚀 Si aucune conversation active, on en crée une maintenant
    if (!convId) {
      const convRef = doc(collection(db, "conversations"));
      await setDoc(convRef, {
        title: text.slice(0, 40) || "Nouvelle conversation",
        createdAt: serverTimestamp(),
      });
      convId = convRef.id;
      setCurrentConversationId(convId);
      currentConversationIdRef.current = convId;
      await loadConversations();
    }

    // 🕐 Si le bot écrit juste après la création, on attend que convId soit dispo
    if (!convId) convId = await waitForConvId(currentConversationIdRef);

    // 💾 On enregistre le message
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
      await setDoc(
        convRef,
        { title },
        { merge: true } // 👈 évite d’écraser les autres champs
      );
    } catch (error) {
      console.error("Erreur mise à jour du titre :", error);
    }
  }
  


  async function loadMessages(conversationId) {
    const q = query(
      collection(db, "conversations", conversationId, "messages"),
      orderBy("timestamp")
    );
    const snapshot = await getDocs(q);
    const loadedMessages = snapshot.docs.map((doc) => doc.data());
    setMessages(loadedMessages);
  }

  async function loadConversations() {
    const q = query(collection(db, "conversations"), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    const convs = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((c) => c.title && c.title.trim() !== "Salut 😊 ! Prêt à commencer une nouvelle conversation ?");
    setConversations(convs);
  }
  function waitForConvId(ref, maxTries = 10) {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const check = () => {
        if (ref.current) return resolve(ref.current);
        tries++;
        if (tries > maxTries) return reject("Timeout convId");
        setTimeout(check, 100);
      };
      check();
    });
  }
  const currentConversationIdRef = useRef(null);
    
  
  useEffect(() => {
    loadConversations();
  }, []);
          
  
  // 🎙️ Transcription audio avec Whisper (Groq)
  const handleTranscription = useCallback(async (audioBlob) => {
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");
    formData.append("model", "whisper-large-v3");

    try {
      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${VITE_GROQ_API_KEY}` },
        body: formData,
      });
      if (!response.ok) throw new Error(`Erreur Whisper: ${response.status}`);
      const data = await response.json();
      if (data.text) {
        addMessage(data.text, "user");
        handleStreamCall(data.text); // 🚀 envoie automatiquement à Qwen
      }
    } catch (err) {
      console.error("Erreur transcription:", err);
    }
  }, [addMessage]);

  // 🎙️ Micro push-to-talk
  const handleMicClick = useCallback(async () => {
      stopTTS(); // 🔇 stoppe toute voix en cours avant d’enregistrer

    if (isRecording) {
      mediaRecorderRef.current?.stop();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          handleTranscription(blob);
          stream.getTracks().forEach((t) => t.stop());
          setIsRecording(false);
        };

        recorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Micro refusé:", err);
        alert("Autorise ton micro pour parler.");
      }
    }
  }, [isRecording, handleTranscription]);

  // 🖼️ Upload image
  const handleImageUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedImage(reader.result);
      addMessage("🖼️ Image chargée, pose ta question.", "user");
    };
    reader.readAsDataURL(file);
  }, [addMessage]);

  // 🧠 Fonction universelle pour appeler Qwen avec mémoire
  const handleStreamCall = useCallback(
  async (promptText, imageData = null) => {
    if (!promptText?.trim()) return;

    setIsBotLoading(true);
    stopFlagRef.current = false;

    try {
      // 🧠 Historique de chat pour la mémoire du modèle
      const history = messages.map((m) => ({
        role: m.from === "user" ? "user" : "assistant",
        content: m.text,
      }));
      history.push({ role: "user", content: promptText });

      // 📤 Données envoyées à ton serveur Node
      const bodyData = imageData
        ? { messages: history, image: imageData } // 👈 on passe l’image ici
        : { messages: history };

      const response = await fetch(`${API_URL}/api/qwen-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      let botIndex;
      setMessages((prev) => {
        botIndex = prev.length;
        return [...prev, { from: "bot", text: "" }];
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk.trim()) continue;

        fullText += chunk;

        setMessages((prev) => {
          const updated = [...prev];
          if (updated[botIndex]) {
            updated[botIndex] = { from: "bot", text: fullText };
          }
          return updated;
        });
      }

     
      if (fullText.trim()) {
        await saveMessage("bot", fullText);
        await speakText(fullText, stopFlagRef, currentAudioRef);
      }
      


    } catch (err) {
      console.error("Erreur stream:", err);
      addMessage(`❌ ${err.message}`, "bot");
    } finally {
      setIsBotLoading(false);
    }
  },
  [messages, addMessage]
);


useEffect(() => {
  if (currentConversationId) {
    loadMessages(currentConversationId);
  }
}, [currentConversationId]);


const navigate = useNavigate();

async function startNewConversation() {
  try {
    const convRef = doc(collection(db, "conversations"));
    await setDoc(convRef, {
      title: "Nouvelle conversation",
      createdAt: serverTimestamp(),
    });

    console.log("✅ Nouvelle conversation créée :", convRef.id);

    // Recharge la liste de conversations
    await loadConversations();

    // 🚀 Redirige vers la nouvelle conversation
    navigate(`/stream/${convRef.id}`);
  } catch (error) {
    console.error("Erreur création conversation :", error);
  }
}


useEffect(() => {
  console.log("🌀 useEffect déclenché : currentConversationId=", currentConversationId);
}, [currentConversationId]);



  // 💬 Envoi clavier ou image
  const handleSend =   useCallback(
    async(e) => {
      e.preventDefault();
      if (!newMessage.trim() && !selectedImage) return;
      if (isBotLoading) return;

      // Si image présente → on l’envoie avec la question (ou sans texte)
      if (selectedImage) {
        addMessage("🖼️ Image envoyée, traitement en cours...", "user");
        await saveMessage("user", newMessage || "Image envoyée");

        handleStreamCall(newMessage || "Analyse cette image", selectedImage);
        setNewMessage("");
        setSelectedImage(null);
        return;
      }

      // Sinon, simple message texte
      addMessage(newMessage, "user");
      saveMessage("user", newMessage);
      // 📝 Met à jour le titre si c'est encore "Nouvelle conversation"
if (conversations.length > 0 && currentConversationId) {
  const conv = conversations.find(c => c.id === currentConversationId);
  if (conv && conv.title === "Nouvelle conversation") {
    updateConversationTitle(currentConversationId, newMessage.slice(0, 40));
    // Recharge la liste pour voir le titre actualisé
    loadConversations();
  }
}


      handleStreamCall(newMessage);
      setNewMessage("");
    },
    [newMessage, isBotLoading, addMessage, handleStreamCall, selectedImage]
  );
  useEffect(() => {
    if (selectedImage) console.log("🖼️ Image prête à l’envoi :", selectedImage.substring(0, 50) + "...");
  }, [selectedImage]);
  
  


  useEffect(() => {
    console.log("💬 État complet des messages:", messages);
  }, [messages]);
  

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

  // Vérifie si une image est collée
  for (const item of items) {
    if (item.type.indexOf("image") !== -1) {
      e.preventDefault(); // empêche le collage brut d’image dans le champ
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
  // sinon, on laisse coller le texte par défaut
}, []);

  return (
    <div className="bg-white text-[#191970] min-h-screen font-[Cinzel] flex flex-col">
      <div className="container mx-auto px-4 pt-6 flex flex-col flex-grow">
        {/* Header */}
      <header className="fixed top-0 left-0 w-full bg-white border-b shadow-sm z-50">
  <div className="container mx-auto px-4 py-3 flex justify-between items-center">
    <h1 className="text-lg font-semibold text-[#191970]">Assistant Vocal Intelligent</h1>

    <nav className="flex items-center space-x-2 bg-gray-100 p-1 rounded-full shadow-inner">
      <Link
        to="/"
        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
          location.pathname === "/"
            ? "bg-[#191970] text-white shadow-md"
            : "text-[#191970] hover:bg-white hover:shadow-sm"
        }`}
      >
        💬 Chat
      </Link>

      <Link
        to="/stream"
        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
          location.pathname === "/stream"
            ? "bg-[#191970] text-white shadow-md"
            : "text-[#191970] hover:bg-white hover:shadow-sm"
        }`}
      >
        ⚡ Stream
      </Link>

      <Link
        to="/voice"
        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
          location.pathname === "/voice"
            ? "bg-[#191970] text-white shadow-md"
            : "text-[#191970] hover:bg-white hover:shadow-sm"
        }`}
      >
        🎙️ Vocal
      </Link>
    </nav>

    <div className="hidden sm:flex items-center space-x-2 text-sm text-[#191970]">
      <SignalHigh className="w-4 h-4" />
      <Wifi className="w-4 h-4" />
      <span>77%</span>
      <BatteryFull className="w-4 h-4" />
    </div>
  </div>
</header>
{/* 💬 Contenu principal : Sidebar + Chat */}
<div className="flex h-[calc(100vh-60px)] mt-[60px] ml-64">

  {/* 🧭 Sidebar gauche */}
  <aside className="hidden md:flex fixed top-[60px] left-0 w-64 h-[calc(100vh-60px)] bg-gray-50 border-r border-gray-200 p-4 flex-col">

  <button
  onClick={() => startNewConversation()}  // 👈 ici
  className="mb-4 bg-blue-500 text-white py-2 rounded-lg shadow hover:bg-blue-600 transition"
>
  + Nouvelle conversation
</button>


    <div className="overflow-y-auto flex-1">
      {conversations.map((conv) => (
        <Link to={`/stream/${conv.id}`}>
        <p>{conv.title}</p>
      </Link>
      ))}
    </div>
  </aside>

  {/* 🧠 Zone du chat principal */}
  <section className="flex-1 flex flex-col bg-white p-6 overflow-y-auto">
    <main className="flex-grow overflow-y-auto space-y-4 text-lg">
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
  </section>
</div>



{!audioUnlocked && (
  <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
    <p className="text-lg text-[#191970] mb-4 text-center">
      🔊 Active le son pour entendre la voix de l’assistant
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


        {/* Footer */}
        <footer className="sticky bottom-0 py-4 bg-white">
          {selectedImage && (
  <div className="mb-4 flex justify-center">
    <div className="relative inline-block">
      <img
        src={selectedImage}
        alt="Prévisualisation"
        className="w-40 h-auto rounded-xl border shadow-md"
      />
      <button
        onClick={() => setSelectedImage(null)}
        className="absolute top-1 right-1 bg-black bg-opacity-60 text-white rounded-full p-1 hover:bg-opacity-80"
        title="Supprimer l’image"
      >
        <X size={14} />
      </button>
    </div>
  </div>
)}

          <form onSubmit={handleSend} className="flex items-center gap-2 mb-4">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
                onPaste={handlePasteInInput}   // 👈 ici

              placeholder="Parle ou écris un message..."
              className="flex-grow border border-gray-400 rounded-lg px-3 py-2 bg-white text-[#191970] focus:outline-none focus:ring-2 focus:ring-[#191970]"
              disabled={isBotLoading || isRecording}
            />
            <button
              type="submit"
              className="bg-[#191970] text-white px-4 py-2 rounded-lg hover:bg-blue-900 transition-colors disabled:opacity-50"
              disabled={isBotLoading}
            >
              <Send className="w-5 h-5" />
            </button>
          </form>

          <div className="flex justify-center items-center space-x-6">
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
              onClick={stopTTS}
              className="bg-gray-200 w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-[#191970] hover:bg-gray-300"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </footer>

        
      </div>
    </div>
  );
}