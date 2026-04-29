/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, 
  Users, 
  Plus, 
  Play, 
  ArrowRight, 
  Cpu, 
  Keyboard, 
  Loader2, 
  CheckCircle2, 
  Zap,
  User
} from 'lucide-react';
import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  collection, 
  onSnapshot, 
  query, 
  where, 
  getDocs,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db, auth, ensureAuth, handleFirestoreError, OperationType, signInWithGoogle } from './lib/firebase';
import { generateQuiz, QuizQuestion } from './lib/gemini';

type Screen = 'welcome' | 'create' | 'waiting' | 'game' | 'results';
type AppRole = 'host' | 'player';

interface PlayerData {
  id: string;
  nickname: string;
  score: number;
  lastAnsweredIndex: number;
  updatedAt: any;
  team: 'red' | 'blue';
}

interface RoomData {
  hostId: string;
  status: 'waiting' | 'active' | 'ended';
  currentQuestionIndex: number;
  createdAt: any;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [role, setRole] = useState<AppRole | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Game State
  const [room, setRoom] = useState<RoomData | null>(null);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [playerMe, setPlayerMe] = useState<PlayerData | null>(null);

  // 1. Welcome Screen Helpers
  const generateRoomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  // 2. Room Creation
  const handleCreateRoom = async (manualQuestions?: QuizQuestion[]) => {
    setLoading(true);
    setError(null);
    try {
      try {
        await ensureAuth();
      } catch (authErr: any) {
        if (authErr.message.includes('ADMIN_REQUIRED')) {
          setError("Anonymous sign-in is disabled. Please enable it in the Firebase Console OR Host using Google Sign-in below.");
          setLoading(false);
          return;
        }
        throw authErr;
      }
      
      const user = auth.currentUser;
      if (!user) throw new Error("Authentication failed.");

      const code = generateRoomCode();
      const roomRef = doc(db, 'rooms', code);
      
      const newRoom: RoomData = {
        hostId: user.uid,
        status: 'waiting',
        currentQuestionIndex: 0,
        createdAt: serverTimestamp(),
      };

      await setDoc(roomRef, newRoom);
      
      // If manual questions provided
      if (manualQuestions) {
        for (let i = 0; i < manualQuestions.length; i++) {
          await setDoc(doc(db, `rooms/${code}/questions`, `q${i}`), manualQuestions[i]);
        }
      }

      setRoomCode(code);
      setRole('host');
      setScreen('waiting');

      // Add host as player so they can participate
      await setDoc(doc(db, `rooms/${code}/players`, user.uid), {
        id: user.uid,
        nickname: user.displayName || 'Game Master',
        score: 0,
        lastAnsweredIndex: -1,
        updatedAt: serverTimestamp(),
        team: 'red'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'rooms');
      setError('Failed to create room.');
    } finally {
      setLoading(false);
    }
  };

  // 3. AI Generation
  const handleAIGenerate = async (criteria: string) => {
    setLoading(true);
    setError(null);
    try {
      const aiQuestions = await generateQuiz(criteria);
      await handleCreateRoom(aiQuestions);
    } catch (err: any) {
      setError(err.message || 'AI Generation failed.');
    } finally {
      setLoading(false);
    }
  };

  // 4. Joining
  const handleJoinRoom = async () => {
    if (!roomCode || !nickname) {
      setError('Room code and nickname are required.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      try {
        await ensureAuth();
      } catch (authErr: any) {
        if (authErr.message.includes('ADMIN_REQUIRED')) {
          setError("Anonymous sign-in is disabled. Please enable it in the Firebase Console to allow players to join without accounts.");
          setLoading(false);
          return;
        }
        throw authErr;
      }
      const user = auth.currentUser;
      if (!user) throw new Error("Authentication failed.");

      const code = roomCode.toUpperCase();
      const roomRef = doc(db, 'rooms', code);
      const roomSnap = await getDoc(roomRef);

      if (!roomSnap.exists()) {
        setError('Room not found.');
        return;
      }

      const roomData = roomSnap.data() as RoomData;
      if (roomData.status !== 'waiting') {
        setError('Game has already started.');
        return;
      }

      // Check Nickname Validation
      const playersRef = collection(db, `rooms/${code}/players`);
      const allPlayersSnap = await getDocs(playersRef);
      const playersCount = allPlayersSnap.size;
      
      const q = query(playersRef, where('nickname', '==', nickname));
      const playerSnap = await getDocs(q);

      if (!playerSnap.empty) {
        setError('Nickname already taken in this arena.');
        return;
      }

      await setDoc(doc(db, `rooms/${code}/players`, user.uid), {
        id: user.uid,
        nickname,
        score: 0,
        lastAnsweredIndex: -1,
        updatedAt: serverTimestamp(),
        team: playersCount % 2 === 0 ? 'red' : 'blue'
      });

      setRoomCode(code);
      setRole('player');
      setScreen('waiting');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'players');
      setError('Failed to join room.');
    } finally {
      setLoading(false);
    }
  };

  // 5. Game Synchronization
  useEffect(() => {
    if (!roomCode || screen === 'welcome') return;

    const code = roomCode.toUpperCase();
    const roomRef = doc(db, 'rooms', code);
    const unsubRoom = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as RoomData;
        setRoom(data);
        if (data.status === 'active') setScreen('game');
        if (data.status === 'ended') setScreen('results');
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `rooms/${code}`));

    const playersRef = collection(db, `rooms/${code}/players`);
    const unsubPlayers = onSnapshot(query(playersRef, orderBy('score', 'desc')), (snapshot) => {
      const playersList = snapshot.docs.map(d => d.data() as PlayerData);
      setPlayers(playersList);
      
      const me = playersList.find(p => p.id === auth.currentUser?.uid);
      if (me) setPlayerMe(me);
    }, (err) => handleFirestoreError(err, OperationType.GET, `rooms/${code}/players`));

    const questionsRef = collection(db, `rooms/${code}/questions`);
    const unsubQuestions = onSnapshot(questionsRef, (snapshot) => {
      const qList = snapshot.docs.map(d => d.data() as QuizQuestion);
      setQuestions(qList);
    }, (err) => handleFirestoreError(err, OperationType.GET, `rooms/${code}/questions`));

    return () => {
      unsubRoom();
      unsubPlayers();
      unsubQuestions();
    };
  }, [roomCode, screen]);

  // 6. Gameplay Actions
  const handleStartGame = async () => {
    if (role !== 'host') return;
    try {
      await updateDoc(doc(db, 'rooms', roomCode), { status: 'active' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
    }
  };

  const handleNextQuestion = async () => {
    if (role !== 'host' || !room) return;
    const nextIndex = room.currentQuestionIndex + 1;
    if (nextIndex >= questions.length) {
      await updateDoc(doc(db, 'rooms', roomCode), { status: 'ended' });
    } else {
      await updateDoc(doc(db, 'rooms', roomCode), { currentQuestionIndex: nextIndex });
    }
  };

  const submitAnswer = async (index: number) => {
    if (!room || !playerMe) return;
    if (playerMe.lastAnsweredIndex === room.currentQuestionIndex) return;

    const currentQ = questions[room.currentQuestionIndex];
    if (!currentQ) return;
    
    const isCorrect = index === currentQ.correctIndex;
    const points = isCorrect ? 100 : 0;

    try {
      await updateDoc(doc(db, `rooms/${roomCode}/players`, auth.currentUser!.uid), {
        score: playerMe.score + points,
        lastAnsweredIndex: room.currentQuestionIndex,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `players/${auth.currentUser?.uid}`);
    }
  };

  const reset = () => {
    setScreen('welcome');
    setRoomCode('');
    setNickname('');
    setRoom(null);
    setPlayers([]);
    setQuestions([]);
    setRole(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 flex flex-col selection:bg-indigo-100 selection:text-indigo-900">
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={screen}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, ease: "circOut" }}
            className="min-h-full"
          >
            {screen === 'welcome' && (
              <WelcomeScreen 
                setScreen={setScreen} 
                roomCode={roomCode} 
                setRoomCode={setRoomCode} 
                nickname={nickname} 
                setNickname={setNickname} 
                handleJoinRoom={handleJoinRoom} 
                loading={loading} 
                error={error} 
                setError={setError}
              />
            )}
            {screen === 'create' && (
              <CreateScreen 
                setScreen={setScreen} 
                handleAIGenerate={handleAIGenerate} 
                handleCreateRoom={handleCreateRoom} 
                loading={loading} 
                error={error} 
                setError={setError}
              />
            )}
            {screen === 'waiting' && (
              <WaitingRoom 
                roomCode={roomCode} 
                players={players} 
                role={role} 
                handleStartGame={handleStartGame} 
              />
            )}
            {screen === 'game' && (
              <GameArena 
                room={room} 
                questions={questions} 
                players={players} 
                playerMe={playerMe} 
                role={role} 
                submitAnswer={submitAnswer} 
                handleNextQuestion={handleNextQuestion} 
                roomCode={roomCode}
              />
            )}
            {screen === 'results' && (
              <ResultsPodium 
                players={players} 
                reset={reset} 
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="py-8 border-t border-gray-100 text-center bg-white">
        <div className="max-w-md mx-auto px-6">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">
            Smart English Resources Academy
          </p>
          <div className="mt-2 flex items-center justify-center space-x-2 text-[8px] text-gray-300 font-bold uppercase tracking-widest">
            <span>Powered by Gemini AI</span>
            <span className="w-1 h-1 bg-gray-200 rounded-full"></span>
            <span>Real-time Arena 1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// --- Sub-components to fix Rules of Hooks ---

function WelcomeScreen({ 
  setScreen, 
  roomCode, 
  setRoomCode, 
  nickname, 
  setNickname, 
  handleJoinRoom, 
  loading, 
  error,
  setError
}: any) {
  return (
    <div className="flex flex-col items-center justify-center space-y-8 p-6 max-w-md mx-auto min-h-[60vh]">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="text-center"
      >
        <h1 className="text-6xl font-black text-indigo-600 mb-2 drop-shadow-sm">Vocab Jam</h1>
        <p className="text-gray-500 font-medium">The Ultimate Word Arena</p>
      </motion.div>

      <div className="w-full space-y-4">
        <button 
          id="btn-create"
          onClick={() => setScreen('create')}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-indigo-200"
        >
          <Plus size={24} />
          <span>Create a Jam</span>
        </button>

        <div className="relative py-4">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-200"></span></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-400 font-bold">Or Join</span></div>
        </div>

        <div className="space-y-4">
          <input 
            id="input-room-code"
            type="text" 
            placeholder="4-LETTER CODE" 
            maxLength={4}
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl text-center text-2xl font-black uppercase focus:border-indigo-500 focus:ring-0 transition-colors"
          />
          <input 
            id="input-nickname"
            type="text" 
            placeholder="NICKNAME" 
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl text-center font-bold focus:border-indigo-500 focus:ring-0 transition-colors"
          />
          <button 
            id="btn-join"
            onClick={handleJoinRoom}
            disabled={loading}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-emerald-200"
          >
            {loading ? <Loader2 className="animate-spin" /> : <Play size={24} />}
            <span>Enter Arena</span>
          </button>
        </div>
      </div>
      {error && (
        <div className="space-y-4 w-full">
          <p id="error-msg" className="text-red-500 text-sm font-bold animate-bounce bg-red-50 p-4 rounded-xl border border-red-100 text-center">{error}</p>
          {error.includes('ADMIN_REQUIRED') && (
            <button 
              onClick={async () => {
                try {
                  await signInWithGoogle();
                  setError(null);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
              className="w-full py-3 bg-white border-2 border-gray-200 rounded-xl font-bold flex items-center justify-center space-x-2 hover:bg-gray-50 transition-all"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
              <span>Join with Google Login</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CreateScreen({ setScreen, handleAIGenerate, handleCreateRoom, loading, error, setError }: any) {
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [prompt, setPrompt] = useState('');
  const [manualText, setManualText] = useState('');

  const processManual = () => {
    const lines = manualText.split('\n').filter(l => l.includes(':'));
    const qList: QuizQuestion[] = lines.map(line => {
      const [word, def] = line.split(':').map(s => s.trim());
      const opts = [def, "Abstract Concept", "Physical Interaction", "Metaphorical Stance"].sort(() => Math.random() - 0.5);
      return {
        word,
        definition: def,
        options: opts,
        correctIndex: opts.indexOf(def)
      };
    });
    handleCreateRoom(qList);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center space-x-4">
        <button onClick={() => setScreen('welcome')} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><ArrowRight className="rotate-180" /></button>
        <h2 className="text-3xl font-black">Host a Jam</h2>
      </div>

      <div className="flex bg-gray-100 p-1 rounded-xl">
        <button 
          onClick={() => setMode('ai')}
          className={`flex-1 py-3 rounded-lg font-bold flex items-center justify-center space-x-2 transition-all ${mode === 'ai' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Cpu size={20} />
          <span>AI Wizard</span>
        </button>
        <button 
          onClick={() => setMode('manual')}
          className={`flex-1 py-3 rounded-lg font-bold flex items-center justify-center space-x-2 transition-all ${mode === 'manual' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Keyboard size={20} />
          <span>Manual Entry</span>
        </button>
      </div>

      {mode === 'ai' ? (
        <div className="space-y-4">
          <label className="block text-sm font-bold text-gray-700">What's the topic?</label>
          <textarea 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. 8th Grade Science, SAT Academic Words, Shakespearean Synonyms..."
            className="w-full h-32 p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:border-indigo-500 focus:ring-0 transition-colors resize-none"
          />
          <button 
            onClick={() => handleAIGenerate(prompt)}
            disabled={loading || !prompt}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold flex items-center justify-center space-x-2 disabled:bg-gray-300 shadow-xl shadow-indigo-100"
          >
            {loading ? <Loader2 className="animate-spin" /> : <Zap size={20} />}
            <span>Generate Quiz with AI</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-bold text-gray-700">Paste your list (Word: Definition)</label>
          <textarea 
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Ethereal: Extremely delicate and light&#10;Melancholy: A feeling of pensive sadness"
            className="w-full h-48 p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:border-indigo-500 focus:ring-0 transition-colors resize-none"
          />
          <button 
            onClick={processManual}
            disabled={loading || !manualText}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold disabled:bg-gray-300 shadow-xl shadow-indigo-100"
          >
            <span>Build Jam Manually</span>
          </button>
        </div>
      )}
      {error && (
        <div className="space-y-4 w-full">
          <p className="text-red-500 font-bold bg-red-50 p-4 rounded-xl text-sm border border-red-100">{error}</p>
          {error.includes('ADMIN_REQUIRED') && (
            <button 
              onClick={async () => {
                try {
                  await signInWithGoogle();
                  setError(null);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
              className="w-full py-3 bg-white border-2 border-gray-200 rounded-xl font-bold flex items-center justify-center space-x-2 hover:bg-gray-50 transition-all"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
              <span>Host with Google Login</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function WaitingRoom({ roomCode, players, role, handleStartGame }: any) {
  return (
    <div className="p-6 max-w-lg mx-auto text-center space-y-12 min-h-screen flex flex-col items-center">
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-400">JOIN AT</h2>
        <div className="text-8xl font-black text-indigo-600 bg-indigo-50 py-8 px-12 rounded-3xl border-4 border-indigo-100 animate-pulse tracking-widest uppercase shadow-inner">
          {roomCode}
        </div>
      </div>

      <div className="w-full space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-black flex items-center space-x-2">
            <Users size={28} className="text-gray-400" />
            <span>Players Joining...</span>
          </h3>
          <span className="bg-indigo-100 text-indigo-600 px-3 py-1 rounded-full font-black">{players.length}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 pb-32">
          <AnimatePresence>
            {players.map((p: any) => (
              <motion.div 
                key={p.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className={`p-4 rounded-xl border-2 font-bold flex items-center space-x-2 shadow-sm ${p.team === 'red' ? 'border-red-100 bg-red-50 text-red-700' : 'border-blue-100 bg-blue-50 text-blue-700'}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${p.team === 'red' ? 'bg-red-200 text-red-700' : 'bg-blue-200 text-blue-700'}`}>
                  <User size={16} />
                </div>
                <span className="truncate">{p.nickname}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-md border-t border-gray-100">
        <div className="max-w-md mx-auto">
          {role === 'host' ? (
            <button 
              id="btn-start"
              onClick={handleStartGame}
              disabled={players.length === 0}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold text-xl shadow-lg shadow-emerald-100 disabled:bg-gray-200 disabled:shadow-none transition-all"
            >
              Start Jam
            </button>
          ) : (
            <div className="text-indigo-600 font-bold flex items-center justify-center space-x-2 animate-pulse">
              <Loader2 className="animate-spin" />
              <span>Waiting for Host to start...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GameArena({ room, questions, players, playerMe, role, submitAnswer, handleNextQuestion, roomCode }: any) {
  if (!room || questions.length === 0) return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="animate-spin text-indigo-600" size={48} />
    </div>
  );
  
  const currentQ = questions[room.currentQuestionIndex];
  if (!currentQ) return null;
  const hasAnswered = playerMe?.lastAnsweredIndex === room.currentQuestionIndex;

  const redScore = players.filter((p: any) => p.team === 'red').reduce((acc: number, p: any) => acc + p.score, 0);
  const blueScore = players.filter((p: any) => p.team === 'blue').reduce((acc: number, p: any) => acc + p.score, 0);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-32">
      {/* Team Score Bar - Vocabulary.com Style */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-4xl mx-auto flex h-16">
          <div className="flex-1 bg-red-500 flex items-center justify-between px-6 text-white relative">
            <span className="font-black italic uppercase tracking-tighter text-xl">Red Team</span>
            <span className="text-3xl font-black">{redScore.toLocaleString()}</span>
            {blueScore < redScore && redScore > 0 && (
              <div className="absolute -bottom-1 left-0 right-0 h-1 bg-white/30"></div>
            )}
          </div>
          <div className="w-1 bg-white z-10"></div>
          <div className="flex-1 bg-blue-500 flex items-center justify-between px-6 text-white relative">
            <span className="text-3xl font-black">{blueScore.toLocaleString()}</span>
            <span className="font-black italic uppercase tracking-tighter text-xl">Blue Team</span>
            {redScore < blueScore && blueScore > 0 && (
              <div className="absolute -bottom-1 left-0 right-0 h-1 bg-white/30"></div>
            )}
          </div>
        </div>
        
        {/* Real-time Individual Leaderboard Bar */}
        <div className="p-2 overflow-x-auto shadow-sm no-scrollbar bg-gray-50 border-t border-gray-100">
          <div className="flex items-center space-x-6 min-w-max px-4">
            {players.slice(0, 8).map((p: any, idx: number) => (
              <div key={p.id} className="flex items-center space-x-2 bg-white px-3 py-1 rounded-full border border-gray-200">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black ${p.team === 'red' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'}`}>
                  {idx + 1}
                </span>
                <span className="font-bold text-xs truncate max-w-[80px]">{p.nickname}</span>
                <span className="text-[10px] font-black text-indigo-600">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 flex flex-col items-center justify-center max-w-4xl mx-auto w-full space-y-12">
        <div className="w-full text-center space-y-6">
          <span className="bg-indigo-100 text-indigo-600 px-4 py-1 rounded-full text-sm font-black uppercase tracking-widest">
            Question {room.currentQuestionIndex + 1} of {questions.length}
          </span>
          <h2 className="text-4xl md:text-6xl font-black text-gray-900 leading-tight">
            What does <span className="text-indigo-600 drop-shadow-sm font-mono tracking-tighter italic">"{currentQ.word}"</span> mean?
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          {currentQ.options.map((opt: string, i: number) => (
            <motion.button
              key={i}
              whileHover={!hasAnswered ? { scale: 1.02, y: -2 } : {}}
              whileTap={!hasAnswered ? { scale: 0.98 } : {}}
              disabled={hasAnswered}
              onClick={() => submitAnswer(i)}
              className={`p-8 rounded-3xl border-4 text-left font-bold text-xl transition-all h-full min-h-[140px] flex items-center shadow-md relative overflow-hidden ${
                hasAnswered 
                  ? i === currentQ.correctIndex 
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-emerald-100' 
                    : 'bg-white border-gray-100 text-gray-300 opacity-50 shadow-none'
                  : 'bg-white border-gray-200 hover:border-indigo-400 hover:shadow-2xl text-gray-700'
              }`}
            >
              <div className="absolute top-0 right-0 w-8 h-8 bg-gray-50 flex items-center justify-center rounded-bl-xl font-black text-[10px] text-gray-300">
                {['A', 'B', 'C', 'D'][i]}
              </div>
              {opt}
            </motion.button>
          ))}
        </div>

        <AnimatePresence>
          {hasAnswered && (
            <motion.div 
              initial={{ y: 20, opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }} 
              className="flex items-center space-x-2 text-indigo-600 font-bold bg-indigo-50 px-8 py-4 rounded-3xl border-2 border-indigo-100 shadow-sm"
            >
              <CheckCircle2 className="animate-bounce" />
              <span>Answer Locked! Waiting for {role === 'host' ? 'others' : 'Host'}...</span>
            </motion.div>
          )}
        </AnimatePresence>

        {role === 'host' && (
          <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-md border-t border-gray-100 flex justify-center">
            <div className="max-w-2xl w-full flex items-center space-x-8">
              <div className="flex-1 flex flex-col">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Progress</span>
                <div className="font-black text-indigo-600 text-xl">
                  {players.filter((p: any) => p.lastAnsweredIndex === room.currentQuestionIndex).length} <span className="text-gray-300">/</span> {players.length} Answers
                </div>
              </div>
              <button 
                id="btn-next"
                onClick={handleNextQuestion}
                className="px-12 py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-3xl font-black text-xl flex items-center space-x-3 shadow-xl shadow-indigo-100 transform hover:scale-105 transition-all"
              >
                <span>{room.currentQuestionIndex + 1 === questions.length ? 'Finish Jam' : 'Next Word'}</span>
                <ArrowRight size={24} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultsPodium({ players, reset }: any) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3);

  const redScore = players.filter((p: any) => p.team === 'red').reduce((acc: number, p: any) => acc + p.score, 0);
  const blueScore = players.filter((p: any) => p.team === 'blue').reduce((acc: number, p: any) => acc + p.score, 0);

  const winningTeam = redScore > blueScore ? 'Red Team' : blueScore > redScore ? 'Blue Team' : 'Tie';
  const winnerColor = redScore > blueScore ? 'text-red-500' : blueScore > redScore ? 'text-blue-500' : 'text-gray-500';

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-16 min-h-screen py-24 text-center">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        className="space-y-6"
      >
        <div className={`text-xl font-black uppercase tracking-[0.5em] ${winnerColor}`}>
          {winningTeam === 'Tie' ? "It's a Tie!" : `${winningTeam} Victors!`}
        </div>
        <h2 className="text-8xl font-black text-gray-900 tracking-tighter">Arena Results</h2>
      </motion.div>

      {/* Team Comparison */}
      <div className="grid grid-cols-2 gap-8 max-w-2xl mx-auto">
        <div className={`p-8 rounded-[40px] border-4 ${redScore > blueScore ? 'bg-red-500 text-white border-red-200' : 'bg-white border-red-500 text-red-500'} shadow-xl`}>
          <div className="text-sm font-black uppercase mb-1">Red Team</div>
          <div className="text-5xl font-black">{redScore.toLocaleString()}</div>
        </div>
        <div className={`p-8 rounded-[40px] border-4 ${blueScore > redScore ? 'bg-blue-500 text-white border-blue-200' : 'bg-white border-blue-500 text-blue-500'} shadow-xl`}>
          <div className="text-sm font-black uppercase mb-1">Blue Team</div>
          <div className="text-5xl font-black">{blueScore.toLocaleString()}</div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-2xl font-black text-gray-400 uppercase tracking-widest italic">Top Performers</h3>
        <div className="flex items-end justify-center space-x-4 h-96 mt-10 px-4 relative max-w-2xl mx-auto">
        {/* Silver */}
        {top3[1] && (
          <motion.div 
            initial={{ height: 0 }} 
            animate={{ height: '70%' }} 
            transition={{ duration: 1, delay: 0.5 }}
            className="flex-1 bg-slate-200 rounded-t-[40px] relative flex flex-col items-center justify-start p-6 shadow-lg"
          >
            <div className="absolute -top-24 text-center w-full">
              <div className="w-16 h-16 bg-slate-100 rounded-full mx-auto flex items-center justify-center border-4 border-white shadow-md mb-2">
                <User size={32} className="text-slate-400" />
              </div>
              <p className="font-black text-lg truncate px-2">{top3[1].nickname}</p>
              <p className="text-slate-500 font-bold">{top3[1].score} pts</p>
            </div>
            <span className="text-6xl font-black text-slate-400/50 mt-4 italic">2ND</span>
          </motion.div>
        )}

        {/* Gold */}
        {top3[0] && (
          <motion.div 
            initial={{ height: 0 }} 
            animate={{ height: '100%' }} 
            transition={{ duration: 1, delay: 0.8 }}
            className="flex-1 bg-yellow-400 rounded-t-[40px] relative flex flex-col items-center justify-start p-6 shadow-[0_20px_60px_rgba(250,204,21,0.5)] z-10"
          >
            <div className="absolute -top-32 text-center w-full">
               <div className="w-24 h-24 bg-yellow-300 rounded-full mx-auto flex items-center justify-center border-8 border-white shadow-xl mb-4 relative">
                 <Trophy className="text-yellow-700" size={40} />
                 <div className="absolute -top-4 -right-4 bg-red-500 text-white w-10 h-10 rounded-full flex items-center justify-center border-4 border-white font-black">1</div>
               </div>
              <p className="font-black text-2xl truncate px-2">{top3[0].nickname}</p>
              <p className="text-yellow-800 font-black tracking-wider">{top3[0].score} pts</p>
            </div>
            <span className="text-8xl font-black text-yellow-700/30 mt-8 italic">1ST</span>
          </motion.div>
        )}

        {/* Bronze */}
        {top3[2] && (
          <motion.div 
            initial={{ height: 0 }} 
            animate={{ height: '50%' }} 
            transition={{ duration: 1, delay: 1 }}
            className="flex-1 bg-orange-200 rounded-t-[40px] relative flex flex-col items-center justify-start p-6 shadow-lg"
          >
            <div className="absolute -top-24 text-center w-full">
              <div className="w-16 h-16 bg-orange-100 rounded-full mx-auto flex items-center justify-center border-4 border-white shadow-md mb-2">
                <User size={32} className="text-orange-400" />
              </div>
              <p className="font-black text-lg truncate px-2">{top3[2].nickname}</p>
              <p className="text-orange-700 font-bold">{top3[2].score} pts</p>
            </div>
            <span className="text-6xl font-black text-orange-900/10 mt-4 italic">3RD</span>
          </motion.div>
        )}
      </div>
    </div>

    <div className="space-y-6 pt-24 max-w-md mx-auto">
        <button 
          id="btn-again"
          onClick={reset}
          className="w-full py-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-3xl font-black text-2xl shadow-2xl shadow-indigo-200 transform hover:scale-105 active:scale-95 transition-all"
        >
          New Arena Jam
        </button>
        <p className="text-gray-300 font-black uppercase text-xs tracking-[0.2em]">Game Over &bull; Arena Concluded</p>
      </div>
    </div>
  );
}
