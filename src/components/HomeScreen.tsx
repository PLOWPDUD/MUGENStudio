import React from 'react';
import { motion } from 'motion/react';
import { 
  Plus, 
  Upload, 
  FolderOpen, 
  Box, 
  HelpCircle, 
  Github,
  Zap
} from 'lucide-react';

interface HomeScreenProps {
  onNewProject: () => void;
  onOpenZip: (files: FileList) => void;
  onImportFolder: (files: FileList) => void;
  onShowDocs: () => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ 
  onNewProject, 
  onOpenZip, 
  onImportFolder,
  onShowDocs
}) => {
  const zipInputRef = React.useRef<HTMLInputElement>(null);
  const folderInputRef = React.useRef<HTMLInputElement>(null);

  const handleZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onOpenZip(e.target.files);
    }
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportFolder(e.target.files);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-100 font-sans selection:bg-purple-500/30">
      <input 
        type="file" 
        ref={zipInputRef} 
        className="hidden" 
        accept=".zip" 
        onChange={handleZipChange}
      />
      <input 
        type="file" 
        ref={folderInputRef} 
        className="hidden" 
        multiple
        onChange={handleFolderChange}
      />
      {/* Ambient background effect */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-purple-900/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-900/10 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-12 lg:py-24">
        {/* Header Section */}
        <header className="mb-16">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-4"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Box className="w-6 h-6 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">MUGENStudio</h1>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h2 className="text-5xl lg:text-7xl font-bold tracking-tighter mb-6 bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">
              Build legacy characters <br />with modern tools.
            </h2>
            <p className="text-xl text-zinc-400 max-w-2xl leading-relaxed">
              A high-performance sprite editor, animation sequencer, and character creation suite for the M.U.G.E.N engine.
            </p>
          </motion.div>
        </header>

        {/* Action Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-24">
          <ActionCard 
            title="New Character"
            description="Start from scratch with a clean workspace and standard character template."
            icon={<Plus className="w-6 h-6" />}
            onClick={onNewProject}
            delay={0.2}
            primary
          />
          <ActionCard 
            title="Open Project"
            description="Import a .ZIP archive containing SFF, AIR, and ACT files to continue editing."
            icon={<Upload className="w-6 h-6" />}
            onClick={() => zipInputRef.current?.click()}
            delay={0.3}
          />
          <ActionCard 
            title="Import Folder"
            description="Load a local directory containing your character source assets."
            icon={<FolderOpen className="w-6 h-6" />}
            onClick={() => folderInputRef.current?.click()}
            delay={0.4}
          />
        </div>

        {/* Footer / Info Section */}
        <footer className="pt-12 border-t border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-8 text-zinc-500">
            <a 
              href="https://github.com/PLOWPDUD/MUGENStudio" 
              target="_blank" 
              rel="noreferrer"
              className="hover:text-zinc-300 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Github className="w-4 h-4" /> Github
            </a>
            <button 
              onClick={onShowDocs}
              className="hover:text-zinc-300 transition-colors flex items-center gap-2 text-sm font-medium pointer-events-auto"
            >
              <HelpCircle className="w-4 h-4" /> Documentation
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span>v1.2.0-stable</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-zinc-600 text-sm italic">
            Proudly optimized for M.U.G.E.N Standard
          </div>
        </footer>
      </div>
    </div>
  );
};

interface ActionCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  delay: number;
  primary?: boolean;
}

const ActionCard: React.FC<ActionCardProps> = ({ title, description, icon, onClick, delay, primary }) => {
  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onClick={onClick}
      className={`relative group text-left p-8 rounded-3xl transition-all duration-300 border h-64 overflow-hidden flex flex-col justify-between
        ${primary 
          ? 'bg-zinc-100 border-white hover:bg-white' 
          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'
        }`}
    >
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-300
        ${primary ? 'bg-zinc-900 text-white' : 'bg-zinc-800 text-zinc-300 group-hover:bg-zinc-700 group-hover:text-white'}
      `}>
        {icon}
      </div>

      <div>
        <h3 className={`text-xl font-bold mb-2 ${primary ? 'text-zinc-900' : 'text-white'}`}>
          {title}
        </h3>
        <p className={`text-sm leading-relaxed ${primary ? 'text-zinc-600' : 'text-zinc-500 group-hover:text-zinc-400'}`}>
          {description}
        </p>
      </div>

      {primary && (
        <div className="absolute top-4 right-4 animate-pulse">
           <Zap className="w-5 h-5 text-purple-600 fill-purple-600" />
        </div>
      )}
    </motion.button>
  );
};

export default HomeScreen;
