import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ChatClassic from "./pages/ChatClassic";
import ChatStream from "./pages/ChatStream";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#f5f5ff] text-[#191970] flex flex-col">
        <header className="p-4 shadow-md bg-white flex justify-center gap-6 font-semibold">
          <Link to="/" className="hover:underline">💬 Chat classique</Link>
          <Link to="/stream" className="hover:underline">⚡ Chat stream</Link>
        </header>

        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<ChatClassic />} />
            <Route path="/stream" element={<ChatStream />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
