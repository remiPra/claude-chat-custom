import { useState, useCallback } from "react";
import { Send, Plus, X, Eye, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_URL = "https://openaiturbo.onrender.com"; // ton backend Render

export default function GroqVisionTest() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [prompt, setPrompt] = useState("Décris cette image");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState("");

  // 📸 Upload classique
  const handleImageUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSelectedImage(reader.result);
    reader.readAsDataURL(file);
  }, []);

  // 📋 Coller une image (Ctrl+V)
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = () => setSelectedImage(reader.result);
        reader.readAsDataURL(blob);
      }
    }
  }, []);

  // 🚀 Envoi au backend Render → /api/groq-vision
  const handleAnalyze = useCallback(async () => {
    if (!selectedImage) {
      alert("Ajoute ou colle une image avant d’analyser !");
      return;
    }

    try {
      setIsLoading(true);
      setResponse("");

      // Retire le prefixe base64
      const base64 = selectedImage.split(",")[1];

      const res = await fetch(`${API_URL}/api/groq-vision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, imageBase64: base64 }),
      });

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || "Aucune réponse 😕";
      setResponse(content);
    } catch (err) {
      setResponse("❌ Erreur : " + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [prompt, selectedImage]);

  return (
    <div
      className="min-h-screen bg-white text-[#191970] font-[Cinzel] flex flex-col items-center py-8 px-4"
      onPaste={handlePaste}
    >
      <h1 className="text-2xl font-bold mb-6">🧠 Test Vision Groq (Llama-4 Scout)</h1>

      {/* Image sélectionnée */}
      {selectedImage ? (
        <div className="relative mb-4">
          <img
            src={selectedImage}
            alt="upload"
            className="w-64 h-auto rounded-xl border shadow-md"
          />
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-2 right-2 bg-black bg-opacity-60 text-white rounded-full p-1 hover:bg-opacity-80"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center w-64 h-40 border-2 border-dashed border-gray-400 rounded-lg cursor-pointer mb-4 hover:bg-gray-50">
          <Plus size={32} className="text-gray-500" />
          <span className="text-gray-500 text-sm mt-2">Clique ou colle une image</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </label>
      )}

      {/* Prompt */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="w-80 border border-gray-400 rounded-lg p-2 mb-4 focus:outline-none focus:ring-2 focus:ring-[#191970]"
        placeholder="Pose ta question sur l’image..."
      />

      {/* Bouton d'analyse */}
      <button
        onClick={handleAnalyze}
        disabled={isLoading}
        className="flex items-center justify-center bg-[#191970] text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-900 transition disabled:opacity-50"
      >
        {isLoading ? (
          <>
            <Loader2 className="animate-spin mr-2" /> Analyse en cours...
          </>
        ) : (
          <>
            <Eye className="mr-2" /> Analyser l’image
          </>
        )}
      </button>

      {/* Résultat */}
      <div className="mt-8 w-full max-w-2xl text-left">
        {response && (
          <div className="p-4 border rounded-lg bg-gray-50 shadow-sm">
            <ReactMarkdown>{response}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
