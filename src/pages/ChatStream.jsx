import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Wifi,
  BatteryFull,
  SignalHigh,
  MessageSquare,
  ChevronRight,
  Search,
} from "lucide-react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

export default function ChatStream() {
  const [conversations, setConversations] = useState([]);
  const [filteredConversations, setFilteredConversations] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();

  // 🔄 Charge la liste des conversations
  async function loadConversations() {
    try {
      const q = query(collection(db, "conversations"), orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      const convs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setConversations(convs);
      setFilteredConversations(convs);
    } catch (error) {
      console.error("Erreur chargement conversations :", error);
    }
  }

  useEffect(() => {
    loadConversations();
  }, []);

  // ➕ Nouvelle conversation
  async function startNewConversation() {
    try {
      const convRef = doc(collection(db, "conversations"));
      await setDoc(convRef, {
        title: "Nouvelle conversation",
        createdAt: serverTimestamp(),
      });

      console.log("✅ Nouvelle conversation créée :", convRef.id);
      navigate(`/stream/${convRef.id}`);
    } catch (error) {
      console.error("Erreur création conversation :", error);
    }
  }

 // 🔍 Recherche dans les messages avec contexte (2-3 phrases)
async function handleSearch(term) {
  setSearchTerm(term);
  if (!term.trim()) {
    setFilteredConversations(conversations);
    setIsSearching(false);
    return;
  }

  setIsSearching(true);
  const lower = term.toLowerCase();
  const matches = [];

  for (const conv of conversations) {
    const messagesRef = collection(db, "conversations", conv.id, "messages");
    const snapshot = await getDocs(messagesRef);

    let foundSnippet = null;

    for (const docSnap of snapshot.docs) {
      const text = docSnap.data().text || "";
      const lowerText = text.toLowerCase();

      if (lowerText.includes(lower)) {
        // Trouve la position du mot clé
        const index = lowerText.indexOf(lower);

        // Découpe en phrases pour un contexte plus large
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        let sentenceIndex = 0;

        // Trouve la phrase où le mot apparaît
        for (let i = 0; i < sentences.length; i++) {
          if (sentences[i].toLowerCase().includes(lower)) {
            sentenceIndex = i;
            break;
          }
        }

        // Prend 1 phrase avant et 1 après pour le contexte
        const start = Math.max(0, sentenceIndex - 1);
        const end = Math.min(sentences.length, sentenceIndex + 2);

        const context = sentences.slice(start, end).join(" ").trim();

        // Mets en évidence le mot clé
        const highlighted = context.replace(
          new RegExp(`(${term})`, "gi"),
          "👉 $1 👈"
        );

        foundSnippet = highlighted + (end < sentences.length ? "…" : "");
        break;
      }
    }

    if (foundSnippet) {
      matches.push({ ...conv, snippet: foundSnippet });
    }
  }

  setFilteredConversations(matches);
  setIsSearching(false);
}


  return (
    <div className="bg-white text-[#191970] min-h-screen font-[Cinzel] flex flex-col">
      {/* 🧭 Header */}
      <header className="fixed top-0 left-0 w-full bg-white border-b shadow-sm z-50">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-lg md:text-xl font-semibold text-[#191970]">
            Tes conversations
          </h1>

          <div className="flex items-center gap-2 text-sm text-[#191970]">
            <SignalHigh className="w-4 h-4" />
            <Wifi className="w-4 h-4" />
            <span>77%</span>
            <BatteryFull className="w-4 h-4" />
          </div>
        </div>
      </header>

      {/* 💬 Contenu principal */}
      <main className="flex flex-col flex-grow pt-[80px] pb-8 container mx-auto px-4 max-w-3xl">
        {/* 🔍 Barre de recherche */}
        <div className="flex items-center mb-6 bg-gray-50 border border-gray-300 rounded-full px-3 py-2 shadow-inner focus-within:ring-2 focus-within:ring-[#191970] transition">
          <Search className="w-5 h-5 text-gray-500 mr-2" />
          <input
            type="text"
            placeholder="Rechercher dans les messages..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="flex-grow bg-transparent outline-none text-[#191970]"
          />
          {isSearching && (
            <span className="text-sm text-gray-400 italic">Recherche...</span>
          )}
        </div>

        {/* ➕ Bouton création */}
        <button
          onClick={startNewConversation}
          className="mb-8 flex items-center justify-center gap-2 bg-[#191970] text-white py-3 rounded-xl shadow-md hover:bg-blue-900 transition transform hover:scale-[1.02]"
        >
          <Plus className="w-5 h-5" /> Nouvelle conversation
        </button>

        {/* Liste responsive */}
        <div className="grid  fadeInUp">
          {filteredConversations.length === 0 ? (
            <p className="text-center text-gray-500 col-span-full py-10">
              {searchTerm
                ? "Aucun message ne correspond à ta recherche."
                : "Aucune conversation pour l’instant."}
            </p>
          ) : (
            filteredConversations.map((conv) => (
              <Link
                key={conv.id}
                to={`/stream/${conv.id}`}
                className="group relative block p-5 rounded-2xl border border-gray-200 bg-white shadow hover:shadow-lg transition-all duration-300 hover:-translate-y-[2px]"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-50 text-[#191970] shadow-inner">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-[#191970] text-base truncate w-[150px] sm:w-[180px]">
                        {conv.title || "Nouvelle conversation"}
                      </h2>
                      {conv.snippet && (
                        <p className="text-xs text-gray-500 mt-1 italic line-clamp-2">
                          “{conv.snippet}”
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {conv.createdAt
                          ? new Date(conv.createdAt.seconds * 1000).toLocaleString(
                              "fr-FR",
                              {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )
                          : "En cours..."}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition" />
                </div>
              </Link>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
