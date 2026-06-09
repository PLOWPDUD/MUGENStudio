import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

const languages = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'ja', name: '日本語' },
  { code: 'ru', name: 'Русский' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'ar', name: 'العربية' },
];

export const LanguagePicker: React.FC = () => {
  const { i18n } = useTranslation();

  return (
    <div className="flex items-center gap-1 px-2 border-l border-zinc-800 ml-auto">
      <Globe className="w-3 h-3 text-zinc-500" />
      <select
        value={i18n.language}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        className="bg-transparent text-[10px] text-zinc-400 outline-none cursor-pointer hover:text-white transition-colors"
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code} className="bg-[#1a1a1a] text-white text-xs">
            {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
};
