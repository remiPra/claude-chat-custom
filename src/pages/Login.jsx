import { useEffect } from "react";
import { signInWithPopup } from "firebase/auth";
import { auth, provider } from "../firebase";
import { useNavigate } from "react-router-dom";
const admin = import.meta.env.VITE_ADMIN_EMAIL;
export default function Login() {
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
        console.log("Utilisateur connecté :", user);
      if (user.email === admin) {
        localStorage.setItem("userEmail", user.email);
        console.log("Accès accordé");
        navigate("/stream");
      } else {
        alert("⛔ Accès refusé : seule l’adresse remipradere@gmail.com est autorisée.");
        await auth.signOut();
      }
    } catch (err) {
      console.error("Erreur de connexion Google :", err);
    }
  };

  useEffect(() => {
    const userEmail = localStorage.getItem("userEmail");
    if (userEmail === admin) navigate("/stream");
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#f5f5ff] text-[#191970]">
      <h1 className="text-2xl font-semibold mb-6">Connexion sécurisée</h1>
      <button
        onClick={handleLogin}
        className="bg-[#191970] text-white px-6 py-3 rounded-full shadow-md hover:bg-blue-900 transition-transform hover:scale-105"
      >
        🔐 Se connecter avec Google
      </button>
    </div>
  );
}
