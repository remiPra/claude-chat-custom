import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ChatClassic from "./pages/ChatClassic";
import ChatStream from "./pages/ChatStream";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#f5f5ff] text-[#191970] flex flex-col">
      
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
