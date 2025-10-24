import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ChatClassic from "./pages/ChatClassic";
import ChatStream from "./pages/ChatStream";
import GroqVisionTest from "./pages/Chatgroq";
import ChatGroq from "./pages/ChatGroq";
import Login from "./pages/Login"; // 👈 on ajoute la page Login
import { auth } from "./firebase";
import { signOut } from "firebase/auth";
import ChatStreamId from "./pages/ChatStreamId";
const admin = import.meta.env.VITE_ADMIN_EMAIL
// 🧱 Route protégée
function PrivateRoute({ children }) {
  const userEmail = localStorage.getItem("userEmail");
  return userEmail === admin ? children : <Navigate to="/login" />;
}

// 🔐 Bouton de déconnexion
function LogoutButton() {
  const handleLogout = async () => {
    await signOut(auth);
    localStorage.removeItem("userEmail");
    window.location.href = "/login";
  };

  return (
    <button
      onClick={handleLogout}
      className="text-sm text-[#191970] hover:underline ml-4"
    >
      Déconnexion
    </button>
  );
}

export default function App() {
  const userEmail = localStorage.getItem("userEmail");

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#f5f5ff] text-[#191970] flex flex-col">
        {/* Header global */}
        {/* <header className="flex justify-between items-center px-6 py-4 bg-white border-b shadow-sm sticky top-0 z-50">
          <h1 className="text-lg font-semibold text-[#191970]">Assistant Intelligent</h1>
          <nav className="flex items-center space-x-3">
            {userEmail === admin && (
              <>
                <a href="/" className="hover:underline">💬 Chat</a>
                <a href="/stream" className="hover:underline">⚡ Stream</a>
                <a href="/voice" className="hover:underline">🎙️ Vocal</a>
                <LogoutButton />
              </>
            )}
          </nav>
        </header> */}

        {/* Routes principales */}
        <main className="flex-grow">
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              path="/"
              element={
                <PrivateRoute>
                  <ChatClassic />
                </PrivateRoute>
              }
            />

            <Route
              path="/stream"
              element={
                <PrivateRoute>
                  <ChatStream />
                </PrivateRoute>
              }
            />

<Route
              path="/stream/:conversationId"
              element={
                <PrivateRoute>
                  <ChatStreamId />
                </PrivateRoute>
              }
            />

            <Route
              path="/test"
              element={
                <PrivateRoute>
                  <GroqVisionTest />
                </PrivateRoute>
              }
            />

            <Route
              path="/voice"
              element={
                <PrivateRoute>
                  <ChatGroq />
                </PrivateRoute>
              }
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
