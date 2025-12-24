import React from "react";
import { X, Plus } from "lucide-react";

export default function MultiImagesInput({ images, setImages }) {

  const handleAddImages = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setImages((prev) => [...prev, reader.result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <label className="p-3 bg-gray-100 rounded-xl cursor-pointer flex items-center gap-2 hover:bg-gray-200 transition">
        <Plus className="w-5 h-5 text-gray-600" />
        Ajouter photos
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleAddImages}
          capture="environment"
        />
      </label>

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img, index) => (
            <div key={index} className="relative">
              <img
                src={img}
                alt="photo"
                className="w-full h-24 object-cover rounded-xl border"
              />
              <button
                onClick={() => removeImage(index)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
