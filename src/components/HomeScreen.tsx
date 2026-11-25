import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { 
  Plus, 
  Upload, 
  FolderOpen, 
  Box, 
  HelpCircle, 
  Github,
  Zap,
  Clock,
  Trash2,
  Swords,
  ArrowRight
} from 'lucide-react';
import { LanguagePicker } from './LanguagePicker';
import { getAllProjects, deleteProject, deleteProjects, SavedProject } from '../lib/projectStorage';

interface HomeScreenProps {
  onNewProject: () => void;
  onOpenZip: (files: FileList) => void;
  onImportFolder: (files: FileList) => void;
  onOpenSavedProject: (project: SavedProject) => void;
  onOpenPlayMode: () => void;
  onShowDocs: () => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ 
  onNewProject, 
  onOpenZip, 
  onImportFolder,
  onOpenSavedProject,
  onOpenPlayMode,
  onShowDocs
}) => {
  const { t } = useTranslation();
  const zipInputRef = React.useRef<HTMLInputElement>(null);
  const folderInputRef = React.useRef<HTMLInputElement>(null);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmClearAutoSaves, setConfirmClearAutoSaves] = useState(false);

  useEffect(() => {
    const loadSaved = async () => {
      try {
        const projects = await getAllProjects();
        setSavedProjects(projects);
      } catch (e) {
        console.error("Failed to load saved projects:", e);
      }
    };
    loadSaved();
  }, []);

  const handleConfirmDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDeletingId(id);
    try {
      await deleteProject(id);
      setSavedProjects(prev => prev.filter(p => p.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error("Failed to delete project:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAutoSaves = async () => {
    const autoIds = savedProjects.filter(p => p.isAutoSave).map(p => p.id);
    if (autoIds.length === 0) return;
    try {
      await deleteProjects(autoIds);
      setSavedProjects(prev => prev.filter(p => !p.isAutoSave));
      setConfirmClearAutoSaves(false);
    } catch (err) {
      console.error("Failed to clear auto-saves:", err);
    }
  };

  const handleZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onOpenZip(e.target.files);
    }
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportFolder(e.target.files);
    }
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-100 font-sans selection:bg-purple-500/30">
      <div className="absolute top-4 right-4 z-50">
        <LanguagePicker />
      </div>
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
            <h1 className="text-2xl font-bold tracking-tight text-white">{t('studio.title')}</h1>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h2 className="text-5xl lg:text-7xl font-bold tracking-tighter mb-6 bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">
               {t('home.tagline').split(' ').map((word, i, arr) => (
                 <React.Fragment key={i}>
                   {word}{i === Math.floor(arr.length / 2) - 1 ? <br /> : ' '}
                 </React.Fragment>
               ))}
            </h2>
            <p className="text-xl text-zinc-400 max-w-2xl leading-relaxed">
              {t('home.description')}
            </p>
          </motion.div>
        </header>

        {/* Part 1 · Create Studio Action Grid */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wide text-zinc-400">
            Part 1 · Character Creation Studio
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <ActionCard 
            title={t('home.newCharacter.title')}
            description={t('home.newCharacter.description')}
            icon={<Plus className="w-6 h-6" />}
            onClick={onNewProject}
            delay={0.2}
            primary
          />
          <ActionCard 
            title={t('home.openProject.title')}
            description={t('home.openProject.description')}
            icon={<Upload className="w-6 h-6" />}
            onClick={() => zipInputRef.current?.click()}
            delay={0.3}
          />
          <ActionCard 
            title={t('home.importFolder.title')}
            description={t('home.importFolder.description')}
            icon={<FolderOpen className="w-6 h-6" />}
            onClick={() => folderInputRef.current?.click()}
            delay={0.4}
          />
        </div>

        {/* Part 2 · Playable Versus Arena */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="mb-16 rounded-3xl border border-emerald-500/30 bg-zinc-900/75 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6"
        >
          <div className="flex items-start gap-5">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-300 shrink-0">
              <Swords className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-400 mb-1">
                Part 2 · Playable Battle Engine
              </p>
              <h3 className="text-2xl font-bold tracking-tight text-white mb-2">
                Versus Battle Arena (1v1 to 4v4)
              </h3>
              <p className="text-sm text-zinc-400 max-w-2xl leading-relaxed mb-3">
                Import custom MUGEN characters or battle with your saved studio creations. Control P1 directly while fighting P2 CPU teams with distinct characters per slot, full CNS stats, specials, projectiles, helpers, and sound effects.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span>1v1 / 2v2 / 3v3 / 4v4</span>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span>P1 vs Selected P2</span>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span>Multi-Character ZIP &amp; File Import</span>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span>Infinite Time &amp; Mobile Pad</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenPlayMode}
            className="px-6 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-lg shadow-emerald-500/20"
          >
            <Swords className="w-4 h-4" />
            Play Battle Arena
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.section>

        {/* Saved Projects & Auto-Saves */}
        {savedProjects.length > 0 && (
          <div className="mb-24">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <h3 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-400" /> Saved Projects & Auto-Saves
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">{savedProjects.length} project(s) stored locally</span>
                {savedProjects.some(p => p.isAutoSave) && (
                  confirmClearAutoSaves ? (
                    <div className="flex items-center gap-1.5 bg-red-950/50 border border-red-700/50 rounded-lg px-2 py-1">
                      <span className="text-[11px] text-red-200 font-medium">Delete all auto-saves?</span>
                      <button
                        type="button"
                        onClick={handleClearAutoSaves}
                        className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold cursor-pointer transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearAutoSaves(false)}
                        className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium cursor-pointer transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearAutoSaves(true)}
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-red-950/40 border border-zinc-800 hover:border-red-700/50 text-zinc-400 hover:text-red-300 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear Auto-Saves
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedProjects.map((proj) => {
                const isConfirming = confirmDeleteId === proj.id;
                const isDeleting = deletingId === proj.id;
                return (
                  <div 
                    key={proj.id}
                    onClick={() => {
                      if (!isConfirming && !isDeleting) onOpenSavedProject(proj);
                    }}
                    className="bg-zinc-900/80 border border-zinc-800 hover:border-purple-500/50 rounded-2xl p-5 transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-12 h-12 rounded-xl bg-zinc-950 border border-purple-500/25 flex items-center justify-center text-purple-400 overflow-hidden shrink-0">
                          {proj.portraitDataUrl ? (
                            <img
                              src={proj.portraitDataUrl}
                              alt={proj.name || 'Character portrait'}
                              className="w-full h-full object-contain"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          ) : (
                            <Box className="w-5 h-5" />
                          )}
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                          {proj.isAutoSave ? 'Auto-Saved' : 'Saved'}
                        </span>
                      </div>

                      <h4 className="font-bold text-white text-base mb-1 truncate group-hover:text-purple-300 transition-colors">
                        {proj.name || 'Untitled Character'}
                      </h4>
                      <p className="text-xs text-zinc-500 mb-3">
                        Updated {new Date(proj.updatedAt).toLocaleString()}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-zinc-400 mb-3">
                        <span>{proj.spriteCount ?? proj.sffData?.images?.length ?? 0} sprites</span>
                        <span className="text-zinc-600">·</span>
                        <span>{proj.animCount ?? 0} anims</span>
                        <span className="text-zinc-600">·</span>
                        <span>{proj.soundCount ?? proj.sndData?.sounds?.length ?? 0} sounds</span>
                      </div>
                    </div>

                    <div
                      className="flex items-center justify-between pt-3 border-t border-zinc-800/80"
                      onClick={(e) => {
                        if (isConfirming) e.stopPropagation();
                      }}
                    >
                      {isConfirming ? (
                        <div className="w-full flex items-center justify-between gap-2">
                          <span className="text-xs text-red-300 font-medium">Delete this project?</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={(e) => handleConfirmDeleteProject(proj.id, e)}
                              className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors"
                            >
                              {isDeleting ? 'Deleting...' : 'Delete'}
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setConfirmDeleteId(null);
                              }}
                              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className="text-xs text-purple-400 font-medium group-hover:underline flex items-center gap-1">
                            Resume Project →
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setConfirmDeleteId(proj.id);
                            }}
                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded cursor-pointer transition-colors"
                            title="Delete Project"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
              <HelpCircle className="w-4 h-4" /> {t('home.documentation')}
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span>v1.2.0-stable</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-zinc-600 text-sm italic">
            {t('home.credits')}
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
