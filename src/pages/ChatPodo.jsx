import { useState, useCallback, useRef, useEffect } from "react";
import { 
  Send, X, Loader2, Camera, Footprints, 
  Stethoscope, FileText, ChevronDown, Sparkles,
  Cloud, PlusCircle, MessageSquare, Clock, ChevronRight, Menu
} from "lucide-react";
import ReactMarkdown from "react-markdown";

// 🔥 Firebase imports
import { db } from "../firebase"; 
import { 
  collection, addDoc, updateDoc, doc, query, orderBy, limit,
  onSnapshot, serverTimestamp 
} from "firebase/firestore";

// 🔑 CONFIG OPENROUTER (GEMINI 3 FLASH)
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY; // ⚠️ REMETS TA CLÉ ICI
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_ID = "google/gemini-3-flash-preview"; // ✅ Le nouveau modèle demandé

// ☁️ CONFIG CLOUDINARY
const CLOUDINARY_CLOUD_NAME = 'dyozolx0p';
const CLOUDINARY_PRESET = 'remi_upload';
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

const SYSTEM_PROMPT = `Tu es PodoAssistant, une IA experte en podologie (Modèle Gemini 3 Flash).
Tes capacités :
1. Analyse clinique : Analyse les photos (pieds, posture, plaies). Décris la morphologie, l'état cutané, les troubles statiques.
2. OCR : Transcris parfaitement les documents médicaux.
3. Synthèse : Si on te donne plusieurs photos et du texte, fais une synthèse cohérente.

Ton ton est professionnel, médical et précis.`;

export default function PodoGemini() {
  const [selectedImages, setSelectedImages] = useState([]);
  const [isUploadingToCloud, setIsUploadingToCloud] = useState(false);
  
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // 1. CHARGEMENT HISTORIQUE FIREBASE
  useEffect(() => {
    const q = query(collection(db, "podo_conversations"), orderBy("updatedAt", "desc"), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setConversations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // 2. UPLOAD CLOUDINARY
  const uploadToCloudinary = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);
    try {
      const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Err Upload');
      const data = await res.json();
      return data.secure_url;
    } catch (err) { console.error(err); return null; }
  };

  // 3. GESTION IMAGES
  const addImages = useCallback(async (files) => {
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    // A. Prévisualisation
    const newImages = [];
    const readPromises = fileArray.map(file => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ 
        id: Date.now() + Math.random(), 
        fileObject: file, 
        data: reader.result, 
        cloudinaryUrl: null, 
        uploading: true
      });
      reader.readAsDataURL(file);
    }));

    const loadedImages = await Promise.all(readPromises);
    setSelectedImages(prev => [...prev, ...loadedImages]);

    // B. Upload Background
    setIsUploadingToCloud(true);
    for (const imgObj of loadedImages) {
      const url = await uploadToCloudinary(imgObj.fileObject);
      setSelectedImages(prev => prev.map(img => img.id === imgObj.id ? { ...img, cloudinaryUrl: url, uploading: false } : img));
    }
    setIsUploadingToCloud(false);
  }, []);

  const handleImageUpload = (e) => { if (e.target.files) addImages(e.target.files); };

  // 4. APPEL API OPENROUTER (GEMINI 3)
  const callGemini = async (userPrompt, images) => {
    const contentPayload = [{ type: "text", text: userPrompt }];
    images.forEach(img => {
      if (img.data) {
        contentPayload.push({
          type: "image_url",
          image_url: { url: img.data } // Gemini accepte le base64 dataURI
        });
      }
    });

    const body = {
      model: MODEL_ID,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.map(m => ({ 
            role: m.role, 
            content: typeof m.content === 'string' ? m.content : "Image envoyée"
        })),
        { role: "user", content: contentPayload }
      ]
    };

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.href, // Requis par OpenRouter pour éviter les erreurs 403
        "X-Title": "PodoAssistant",
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || `Erreur API ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Erreur de réponse API";
  };

  // 5. SAUVEGARDE ET ENVOI
  const handleSend = async () => {
    if (!prompt.trim() && selectedImages.length === 0) return;
    if (selectedImages.some(img => img.uploading)) { alert("Attends la fin de l'upload des images !"); return; }

    // ✅ CORRECTION FIRESTORE : On s'assure qu'aucune valeur n'est "undefined"
    const safeImages = selectedImages.map(img => ({
        url: img.cloudinaryUrl || null, // Si pas d'URL, on met null (pas undefined)
        name: img.name || "image"
    })).filter(img => img.url !== null); // On garde que ceux qui ont une URL valide

    const userMsg = {
      role: "user",
      content: prompt,
      images: safeImages,
      timestamp: new Date()
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setPrompt("");
    setIsLoading(true);
    
    let convId = currentConversationId;
    if (!convId) {
      const docRef = await addDoc(collection(db, "podo_conversations"), {
        title: prompt.slice(0, 40) || "Nouvelle analyse",
        updatedAt: serverTimestamp(), messages: []
      });
      convId = docRef.id;
      setCurrentConversationId(convId);
    }

    try {
      const aiResponseText = await callGemini(userMsg.content, selectedImages);
      
      const aiMsg = {
        role: "assistant",
        content: aiResponseText,
        timestamp: new Date()
      };

      const finalMessages = [...newMessages, aiMsg];
      setMessages(finalMessages);
      
      // Sauvegarde propre (on convertit les dates en string pour éviter les bugs)
      await updateDoc(doc(db, "podo_conversations", convId), {
        messages: finalMessages.map(m => ({ 
            ...m, 
            timestamp: m.timestamp.toISOString() 
        })),
        updatedAt: serverTimestamp()
      });

      setSelectedImages([]); 
    } catch (error) {
      console.error(error);
      setMessages([...newMessages, { role: "assistant", content: `❌ Erreur : ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 🛡️ CHARGEMENT SÉCURISÉ
  const loadConversation = (conv) => {
    try {
        setCurrentConversationId(conv.id);
        const safeMessages = (conv.messages || []).map(m => {
            // Nettoyage des images pour éviter les crashs
            const safeImgs = (m.images || []).map(img => {
                if (img?.url) return { url: img.url };
                if (img?.data) return { url: img.data };
                if (typeof img === 'string') return { url: img };
                return null;
            }).filter(Boolean);

            return {
                ...m,
                content: m.content || "",
                images: safeImgs,
                timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
            };
        });

        setMessages(safeMessages);
        setShowSidebar(false);
    } catch (error) {
        console.error("Erreur lecture conversation", error);
    }
  };
  
  const startNew = () => { setCurrentConversationId(null); setMessages([]); setSelectedImages([]); setShowSidebar(false); };

  const formatDate = (dateInput) => {
    if (!dateInput) return "";
    const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    return d.toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'});
  };

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans">
      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-white border-r transform transition-transform duration-300 ${showSidebar ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="p-4 border-b">
          <button onClick={startNew} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition">
            <PlusCircle className="w-4 h-4" /> Nouvelle Session
          </button>
        </div>
        <div className="p-2 overflow-y-auto h-full pb-20">
            {conversations.map(c => (
                <button key={c.id} onClick={() => loadConversation(c)} className={`w-full text-left p-3 rounded-lg mb-1 text-sm ${currentConversationId === c.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-100 text-slate-700'}`}>
                    <div className="font-medium truncate">{c.title || "Conversation"}</div>
                    <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3"/> {formatDate(c.updatedAt)}
                    </div>
                </button>
            ))}
        </div>
      </aside>
      
      {showSidebar && <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setShowSidebar(false)} />}

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-72 transition-all">
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
            <button onClick={() => setShowSidebar(!showSidebar)} className="lg:hidden p-2 bg-slate-100 rounded-lg"><Menu className="w-5 h-5"/></button>
            <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center text-white"><Sparkles className="w-5 h-5"/></div>
                <h1 className="font-bold text-slate-800">PodoGemini <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Flash 3 Preview</span></h1>
            </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 space-y-6">
            {messages.length === 0 && (
                <div className="text-center py-20 text-slate-400">
                    <Footprints className="w-16 h-16 mx-auto mb-4 opacity-20"/>
                    <p>Envoie une photo, une ordonnance ou pose une question.</p>
                </div>
            )}
            
            {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] space-y-2`}>
                        {msg.images && msg.images.length > 0 && (
                             <div className={`flex flex-wrap gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                                {msg.images.map((img, idx) => (
                                    <img 
                                        key={idx} 
                                        src={img.url || img} 
                                        className="w-32 h-32 object-cover rounded-lg border bg-white" 
                                        alt="analyse"
                                    />
                                ))}
                             </div>
                        )}
                        {/* ✅ CORRECTION ICI : Pas de className sur ReactMarkdown */}
                        <div className={`p-4 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border text-slate-800'}`}>
                            {msg.role === 'user' ? (
                                msg.content
                            ) : (
                                <div className="prose prose-sm max-w-none">
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}
            {isLoading && <div className="flex justify-start"><div className="bg-white border px-4 py-3 rounded-2xl flex items-center gap-2 shadow-sm"><Loader2 className="animate-spin w-4 h-4 text-blue-600"/> <span className="text-sm text-slate-500">Gemini 3 réfléchit...</span></div></div>}
            <div ref={messagesEndRef} />
        </main>

        <footer className="p-4 bg-white border-t">
            <div className="max-w-3xl mx-auto space-y-3">
                {selectedImages.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {selectedImages.map(img => (
                            <div key={img.id} className="relative group flex-shrink-0">
                                <img src={img.data} className={`w-16 h-16 rounded-lg object-cover border ${img.uploading ? 'opacity-50':''}`} />
                                {img.uploading ? <Loader2 className="absolute inset-0 m-auto animate-spin w-5 h-5 text-blue-600"/> : <Cloud className="absolute bottom-0 right-0 w-4 h-4 text-green-500 bg-white rounded-full p-0.5"/>}
                                <button onClick={() => setSelectedImages(selectedImages.filter(i => i.id !== img.id))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5"><X className="w-3 h-3"/></button>
                            </div>
                        ))}
                    </div>
                )}
                
                <div className="flex gap-2">
                    <label className="p-3 hover:bg-slate-100 rounded-xl cursor-pointer transition text-slate-500">
                        <Camera className="w-6 h-6"/>
                        <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
                    </label>
                    <input 
                        ref={textareaRef}
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        placeholder="Message pour Gemini..."
                        className="flex-1 bg-slate-100 border-none rounded-xl px-4 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button onClick={handleSend} disabled={isLoading || selectedImages.some(i => i.uploading)} className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition shadow-lg shadow-blue-500/30">
                        <Send className="w-5 h-5"/>
                    </button>
                </div>
            </div>
        </footer>
      </div>
    </div>
  );
}