import React from 'react';
import { motion } from 'motion/react';
import { X, Book, Zap, Layers, Palette, Play, ChevronRight } from 'lucide-react';

interface DocumentationProps {
  onClose: () => void;
}

const Documentation: React.FC<DocumentationProps> = ({ onClose }) => {
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
            <h2 className="text-xl font-bold text-white">Documentation</h2>
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
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" /> Getting Started
              </h3>
              <p className="text-zinc-400 leading-relaxed mb-4">
                MUGENStudio is a modern suite for M.U.G.E.N character development. You can import existing characters as .zip archives or create new projects from templates.
              </p>
              <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
                <ul className="space-y-2 text-sm text-zinc-300">
                  <li className="flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 mt-1 text-zinc-500" />
                    <span><strong>Importing:</strong> Use the "Open Project" button on home screen to load a ZIP containing your .def, .sff, and .air files.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 mt-1 text-zinc-500" />
                    <span><strong>Templates:</strong> New projects start with standard M.U.G.E.N boilerplate characters.</span>
                  </li>
                </ul>
              </div>
            </section>

            <section className="mb-12">
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-500" /> Sprite Management (SFF)
              </h3>
              <p className="text-zinc-400 leading-relaxed mb-4">
                MUGENStudio supports SFF v1.1. You can browse, add, and modify sprites directly in the Sprites tab.
              </p>
              <div className="space-y-4 text-zinc-300 border-l-2 border-zinc-800 pl-4 py-1">
                <div>
                  <h4 className="font-bold text-white">Importing Sprites</h4>
                  <p className="text-sm">When importing images, you can choose to adapt them to the current master palette or exchange colors.</p>
                </div>
                <div>
                  <h4 className="font-bold text-white">Axis Control</h4>
                  <p className="text-sm text-zinc-400 italic">Pro-tip: Left-click and drag on the sprite preview to adjust the drawing axis.</p>
                </div>
              </div>
            </section>

            <section className="mb-12">
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Palette className="w-5 h-5 text-pink-500" /> Palettes (ACT)
              </h3>
              <p className="text-zinc-400 leading-relaxed mb-4">
                Manage your character's color schemes. Each character typically has a primary palette (1,1).
              </p>
              <ul className="grid grid-cols-1 gap-2 text-sm">
                <li className="bg-zinc-900 p-3 rounded-lg border border-zinc-800">
                  <span className="text-purple-400 font-mono">Index 0</span> is always reserved for transparency.
                </li>
                <li className="bg-zinc-900 p-3 rounded-lg border border-zinc-800">
                  Use the <span className="text-white font-bold">Unify SFF</span> tool to force all matching colors to point to the current master palette.
                </li>
              </ul>
            </section>

            <section className="mb-12">
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Play className="w-5 h-5 text-green-500" /> Animations (AIR)
              </h3>
              <p className="text-zinc-400 leading-relaxed mb-4">
                Build sophisticated move sets using the Animation Sequencer.
              </p>
              <div className="bg-purple-900/10 rounded-xl p-4 border border-purple-500/20">
                <p className="text-sm text-purple-200">
                  Animations correlate SFF group numbers and elements with timing and collision data. You can preview sequences in real-time with the built-in player.
                </p>
              </div>
            </section>

            <div className="pt-8 border-t border-zinc-800 text-center">
              <p className="text-zinc-500 text-sm italic">
                Happy Creating! Check our GitHub for advanced scripting guides.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default Documentation;
