import { StrictMode, useState } from 'react';
import MugenStudio from './components/MugenStudio';
import HomeScreen from './components/HomeScreen';
import Documentation from './components/Documentation';
import { VersusArena } from './components/VersusArena';
import { AnimatePresence } from 'motion/react';

export default function App() {
  const [view, setView] = useState<'home' | 'editor' | 'play'>('home');
  const [initialData, setInitialData] = useState<any>(null);
  const [showDocs, setShowDocs] = useState(false);

  const handleNewProject = () => {
    setInitialData({ type: 'new', timestamp: Date.now() });
    setView('editor');
  };

  const handleOpenZip = (files: FileList) => {
    setInitialData({ type: 'open_zip', timestamp: Date.now(), files });
    setView('editor');
  };

  const handleImportFolder = (files: FileList) => {
    setInitialData({ type: 'import_folder', timestamp: Date.now(), files });
    setView('editor');
  };

  const handleOpenSavedProject = (projectData: any) => {
    setInitialData({ type: 'saved_project', timestamp: Date.now(), projectData });
    setView('editor');
  };

  return (
    <StrictMode>
      {view === 'home' ? (
        <HomeScreen 
          onNewProject={handleNewProject}
          onOpenZip={handleOpenZip}
          onImportFolder={handleImportFolder}
          onOpenSavedProject={handleOpenSavedProject}
          onOpenPlayMode={() => setView('play')}
          onShowDocs={() => setShowDocs(true)}
        />
      ) : view === 'play' ? (
        <VersusArena onBackToHome={() => setView('home')} />
      ) : (
        <MugenStudio 
          key={initialData?.timestamp}
          initialAction={initialData?.type} 
          initialFiles={initialData?.files}
          initialProject={initialData?.projectData}
          onBackToHome={() => setView('home')} 
          onShowDocs={() => setShowDocs(true)}
        />
      )}

      <AnimatePresence>
        {showDocs && <Documentation onClose={() => setShowDocs(false)} />}
      </AnimatePresence>
    </StrictMode>
  );
}
