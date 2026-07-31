"use client";

import Image from 'next/image';
import { useState } from 'react';

interface ImageUploaderProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function ImageUploader({ value, onChange }: ImageUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [previews, setPreviews] = useState<string[]>(value);

  const visiblePreviews = value.length > 0 ? value : previews;

  const handleFiles = (files: FileList | null) => {
    if (!files) return;

    const nextUrls = Array.from(files).map((file) => URL.createObjectURL(file));
    const merged = [...visiblePreviews, ...nextUrls];
    setPreviews(merged);
    onChange(merged);
  };

  const removeImage = (url: string) => {
    const next = visiblePreviews.filter((item) => item !== url);
    setPreviews(next);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-slate-700">Property images</label>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition ${dragActive ? 'border-slate-900 bg-slate-50' : 'border-slate-300'}`}
      >
        <p className="text-sm text-slate-600">Drag and drop photos here or select files to upload.</p>
        <input
          type="file"
          multiple
          accept="image/*"
          className="mt-4 block w-full text-sm text-slate-600"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>

      {visiblePreviews.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {visiblePreviews.map((url) => (
            <div key={url} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white">
              <Image src={url} alt="Property preview" width={400} height={240} className="h-40 w-full object-cover" unoptimized />
              <button
                type="button"
                onClick={() => removeImage(url)}
                className="absolute right-2 top-2 rounded-full bg-slate-900/80 px-2 py-1 text-xs font-medium text-white"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
