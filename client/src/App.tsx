import { useCallback, useEffect, useState } from 'react';
import { healthCheck } from './lib/api';
import { CurriculumProgressMap } from './features/curriculum/CurriculumProgressMap';
import { LoadingSpinner } from '@components/ui';
import { GraduationCap } from 'lucide-react';

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState<'connected' | 'error'>('connected');

  const initializeApp = useCallback(async () => {
    try {
      setIsLoading(true);
      try {
        await healthCheck();
        setApiStatus('connected');
      } catch {
        setApiStatus('error');
      }
    } catch {
      setApiStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <LoadingSpinner size={48} className="mx-auto mb-4" />
          <p className="text-gray-600">Loading IU Smart Study Planner...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm border-b px-6 py-4 flex items-center gap-4">
        <GraduationCap size={28} className="text-primary-600" />
        <h1 className="font-bold text-lg text-gray-900">IU Smart Study Planner</h1>
        {apiStatus === 'error' && (
          <span className="text-sm text-red-600 bg-red-50 px-3 py-1 rounded-full ml-auto">
            API Disconnected
          </span>
        )}
      </header>

      <main className="flex-1 p-6 overflow-hidden w-full max-w-full">
        <CurriculumProgressMap />
      </main>
    </div>
  );
}

export default App;
