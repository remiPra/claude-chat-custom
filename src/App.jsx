import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ChatClassic from "./pages/ChatClassic";
import ChatStream from "./pages/ChatStream";
import GroqVisionTest from "./pages/Chatgroq";
import ChatGroq from "./pages/ChatGroq";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#f5f5ff] text-[#191970] flex flex-col">
      
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<ChatClassic />} />
            <Route path="/stream" element={<ChatStream />} />
            <Route path="/test" element={<GroqVisionTest />} />
            <Route path="/voice" element={<ChatGroq />} />

          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
