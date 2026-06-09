import React from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { X, Book, Zap, Layers, Palette, Play, ChevronRight } from 'lucide-react';

interface DocumentationProps {
  onClose: () => void;
}

const Documentation: React.FC<DocumentationProps> = ({ onClose }) => {
  const { t } = useTranslation();

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-[#0a0a0c]/95 backdrop-blur-md flex justify-end"
    >
      <motion.div 
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="w-full max-w-2xl bg-[#121214] border-l border-zinc-800 shadow-2xl h-full flex flex-col"
      >
        <header className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Book className="w-5 h-5 text-purple-500" />
            <h2 className="text-xl font-bold text-white">{t('docs.title')}</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="prose prose-invert max-w-none">
            <section className="mb-12">
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2 text-white">
                <Zap className="w-5 h-5 text-yellow-500" /> {t('docs.gettingStarted')}
              </h3>
              <p className="text-zinc-100 leading-relaxed mb-4">
                {t('docs.getStartedDesc')}
              </p>
              <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
                <ul className="space-y-2 text-sm text-zinc-100">
                  <li className="flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 mt-1 text-zinc-500" />
                    <span><strong>{t('docs.qa1_title')}:</strong> {t('docs.qa1_desc')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 mt-1 text-zinc-500" />
                    <span><strong>{t('docs.qa2_title')}:</strong> {t('docs.qa2_desc')}</span>
                  </li>
                </ul>
              </div>
            </section>

            <section className="mb-12">
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2 text-white">
                <Layers className="w-5 h-5 text-blue-500" /> {t('docs.spriteManagement')}
              </h3>
              <p className="text-zinc-100 leading-relaxed mb-4">
                {t('docs.spriteDesc')}
              </p>
              <div className="space-y-4 text-zinc-100 border-l-2 border-zinc-800 pl-4 py-1">
                <div>
                  <h4 className="font-bold text-white">{t('docs.spriteTitle1')}</h4>
                  <p className="text-sm">{t('docs.spriteNote1')}</p>
                </div>
                <div>
                  <h4 className="font-bold text-white">{t('docs.spriteTitle2')}</h4>
                  <p className="text-sm text-zinc-300 italic">{t('docs.spriteNote2')}</p>
                </div>
              </div>
            </section>

            <section className="mb-12">
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2 text-white">
                <Palette className="w-5 h-5 text-pink-500" /> {t('docs.palettes')}
              </h3>
              <p className="text-zinc-100 leading-relaxed mb-4">
                {t('docs.palettesDesc')}
              </p>
              <ul className="grid grid-cols-1 gap-2 text-sm">
                <li className="bg-zinc-900 p-3 rounded-lg border border-zinc-800 text-white">
                  <span className="text-purple-400 font-mono">{t('docs.paletteNote1_term')}</span> {t('docs.paletteNote1_desc')}
                </li>
                <li className="bg-zinc-900 p-3 rounded-lg border border-zinc-800 text-white">
                   {t('docs.paletteNote2')}
                </li>
              </ul>
            </section>

            <section className="mb-12">
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2 text-white">
                <Play className="w-5 h-5 text-green-500" /> {t('docs.animations')}
              </h3>
              <p className="text-zinc-100 leading-relaxed mb-4">
                {t('docs.animationsDesc')}
              </p>
              <div className="bg-purple-900/10 rounded-xl p-4 border border-purple-500/20">
                <p className="text-sm text-white">
                  {t('docs.animationsNote')}
                </p>
              </div>
            </section>

            <div className="pt-8 border-t border-zinc-800 text-center">
              <p className="text-zinc-400 text-sm italic">
                {t('docs.footer')}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default Documentation;
