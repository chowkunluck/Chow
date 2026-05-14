import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User as UserIcon,
  Settings,
  Upload,
  Activity,
  Radar as RadarIcon,
  AlertTriangle,
  Brain,
  Sparkles,
  Search,
  Scan,
  Database,
  ChevronRight,
  MessageSquare,
  TrendingUp,
  ShieldCheck,
  LogOut,
  Image as ImageIcon,
  Heart,
  Target,
  LayoutDashboard,
  Workflow
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import {
  auth,
  db,
  loginWithGoogle,
  logout,
  completeGoogleRedirect,
  handleFirestoreError,
  OperationType
} from './lib/firebase';
import {
  onAuthStateChanged,
  User
} from 'firebase/auth';
import {
  doc,
  onSnapshot,
  setDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';

import ConnectingScreen from './components/ConnectingScreen';
import LoginScreen from './components/LoginScreen';
import Radar5DChart from './components/Radar5DChart';

type CompetencyLog = {
  id?: string;
  created_at?: string;
  topic?: string | null;
  logic_score?: number;
  accuracy_score?: number;
  analysis_score?: number;
  application_score?: number;
  connectivity_score?: number;
};

type StudentAggregates = {
  student_readiness_avg?: number | null;
  room_readiness_avg?: number | null;
  grade_readiness_avg?: number | null;
  room?: string | null;
  grade?: string | null;
  [k: string]: any;
};

type StudentProfile = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  grade?: string | null;
  room?: string | null;
  school?: { id?: string | null; name?: string | null; domain?: string | null } | null;
  [k: string]: any;
};

function clampPct(n: number): number {
  const x = Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, x));
}

function readinessFromScores(scores: {
  Logic?: number;
  Accuracy?: number;
  Analysis?: number;
  Application?: number;
  Connectivity?: number;
}): number {
  const logic = scores.Logic ?? 0;
  const analysis = scores.Analysis ?? 0;
  const application = scores.Application ?? 0;
  const accuracy = scores.Accuracy ?? 0;
  const connectivity = scores.Connectivity ?? 0;
  return (
    logic * 0.4 +
    analysis * 0.3 +
    application * 0.15 +
    accuracy * 0.1 +
    connectivity * 0.05
  );
}

type DimensionKey = 'Logic' | 'Accuracy' | 'Analysis' | 'Application' | 'Connectivity';
type DetailedDimension = { score: number; reason: string };
type DetailedAnalysis = Record<DimensionKey, DetailedDimension>;

function getDimScore(v: any): number {
  if (typeof v === 'number') return v;
  if (v && typeof v.score === 'number') return v.score;
  return 0;
}

function getDimReason(v: any): string {
  if (!v) return '';
  if (typeof v.reason === 'string') return v.reason;
  return '';
}

function normalizeDetailedAnalysis(obj: any): DetailedAnalysis | null {
  if (!obj || typeof obj !== 'object') return null;
  const keys: DimensionKey[] = ['Logic', 'Accuracy', 'Analysis', 'Application', 'Connectivity'];
  const out: any = {};
  for (const k of keys) {
    const v = (obj as any)[k];
    out[k] = { score: getDimScore(v), reason: getDimReason(v) };
  }
  return out as DetailedAnalysis;
}

// After a successful scan, always show the 5-D Competency page so the user sees the detailed AI feedback.
const AUTO_TAB_AFTER_SCAN = true;
// Requirement: clear page data on every browser refresh (do not restore previous scan/chat UI state).
const CLEAR_UI_ON_REFRESH = true;

/**
 * Base URL ของ backend
 * - ถ้ามี VITE_API_BASE หรือ VITE_RAILWAY_URL → ใช้อันนั้น
 * - ถ้าเป็น production และไม่ตั้งค่า → ใช้ relative path (คาดว่ามี proxy / same-origin)
 */
const API_BASE =
  ((import.meta.env.VITE_API_BASE as string | undefined) ||
    (import.meta.env.VITE_RAILWAY_URL as string | undefined) ||
    // Use 127.0.0.1 (IPv4) to avoid localhost->IPv6 (::1) resolution issues that cause "Failed to fetch".
    (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '')
  ).replace(/\/$/, '');

function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

function googleCheckUrl(email: string, name: string): string {
  const qs = new URLSearchParams({ email, name });
  const path = `/auth/google-check?${qs.toString()}`;
  return apiUrl(path);
}

// API Callers
const callAnalyze = async (file: File, token: string) => {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(apiUrl('/api/analyze'), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  if (!res.ok) {
    // พยายามดึงข้อความ error จาก backend ให้ชัดเจน
    const raw = await res.text();
    let msg = raw || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(raw);
      msg =
        (j?.message as string | undefined) ||
        (j?.detail as string | undefined) ||
        msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json();
};

const callChat = async (history: any[], message: string) => {
  const res = await fetch(apiUrl('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, message })
  });
  if (!res.ok) throw new Error('Chat failed');
  const data = await res.json();
  return data.response;
};

const callFatigue = async (context: string) => {
  const res = await fetch(apiUrl('/api/fatigue'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context })
  });
  if (!res.ok) throw new Error('Fatigue check failed');
  return res.json();
};

const callStudentData = async (token: string): Promise<{ logs: CompetencyLog[]; aggregates?: StudentAggregates }> => {
  const res = await fetch(apiUrl('/api/student/data'), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const raw = await res.text();
    throw new Error(raw || `HTTP ${res.status}`);
  }
  return res.json();
};

const callStudentProfile = async (token: string): Promise<{ profile: StudentProfile | null }> => {
  const res = await fetch(apiUrl('/api/student/profile'), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const raw = await res.text();
    throw new Error(raw || `HTTP ${res.status}`);
  }
  return res.json();
};

// Default dimensions for UI placeholders
const DEFAULT_DIMENSIONS = [
  { subject: 'Logic (TIMSS)', value: 0, full: 100 },
  { subject: 'Literacy (PISA)', value: 0, full: 100 },
  { subject: 'Precision (Common Core)', value: 0, full: 100 },
  { subject: 'Higher-order (Bloom)', value: 0, full: 100 },
  { subject: 'Synthesis', value: 0, full: 100 },
];

type AppTab = 'dashboard' | 'competency' | 'roadmap' | 'tutor' | 'management';

export default function App() {
  const [sessionClientTs] = useState(() => Date.now());
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [railwayToken, setRailwayToken] = useState<string | null>(() => localStorage.getItem('rw_token'));
  /** False until Firebase has delivered the first auth snapshot and any backend link finished. */
  const [authGateReady, setAuthGateReady] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [isScanning, setIsScanning] = useState(false);
  const [latestScan, setLatestScan] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [fatigueData, setFatigueData] = useState({
    overloadIndex: 30,
    status: 'STABLE',
    recommendation: 'Neural networks are balanced. Proceed with exploration.'
  });
  const [competencyLogs, setCompetencyLogs] = useState<CompetencyLog[]>([]);
  const [studentAggregates, setStudentAggregates] = useState<StudentAggregates>({});
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null);
  const [isStudentDataLoading, setIsStudentDataLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  /** Bumps on every auth callback so stale async google-check results are ignored (fixes race / StrictMode double invoke). */
  const authEpochRef = useRef(0);
  /** Used to filter out old scan/chat history after refresh (fresh session). */
  const sessionStartRef = useRef<number>(Date.now());

  // Finish Google redirect flow (required for signInWithRedirect)
  useEffect(() => {
    completeGoogleRedirect().catch((e) => console.warn('getRedirectResult:', e));
  }, []);

  // Clear page data on refresh: do NOT restore cached scan/chat state.
  useEffect(() => {
    if (!CLEAR_UI_ON_REFRESH) return;
    try {
      localStorage.removeItem('latest_scan');
    } catch {
      // ignore
    }
    setLatestScan(null);
    setChatMessages([]);
    setChatError(null);
  }, []);

  // Backend history/profile for 5-D + Roadmap + Settings (Supabase)
  useEffect(() => {
    if (!railwayToken) return;
    let cancelled = false;

    (async () => {
      setIsStudentDataLoading(true);
      try {
        const [data, prof] = await Promise.all([
          callStudentData(railwayToken),
          callStudentProfile(railwayToken),
        ]);
        if (cancelled) return;

        const logs = Array.isArray(data?.logs) ? data.logs : [];
        setCompetencyLogs(logs);
        setStudentAggregates((data?.aggregates as any) ?? {});
        setStudentProfile((prof?.profile as any) ?? null);

        // If Firebase scans are blocked (permissions), still populate latestScan from backend history.
        if (!CLEAR_UI_ON_REFRESH && !latestScan && logs.length > 0) {
          const l0 = logs[0];
          setLatestScan({
            dimensions: {
              logic: l0.logic_score ?? 0,
              literacy: l0.accuracy_score ?? 0,
              precision: l0.analysis_score ?? 0,
              higherOrder: l0.application_score ?? 0,
              synthesis: l0.connectivity_score ?? 0
            },
            topic: l0.topic || 'Auto',
            careerInsight: '',
            prerequisiteCorrelation: '',
            timestamp: l0.created_at ? new Date(l0.created_at) : new Date(),
          });
        }
      } catch (e) {
        console.warn('Failed to load student data/profile:', e);
      } finally {
        if (!cancelled) setIsStudentDataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [railwayToken]);

  // Auth listener + school backend token (rw_token)
  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      const myEpoch = ++authEpochRef.current;
      if (cancelled) return;

      if (!u?.email) {
        setUser(null);
        setRailwayToken(null);
        localStorage.removeItem('rw_token');
        if (!cancelled && myEpoch === authEpochRef.current) {
          setAuthGateReady(true);
        }
        return;
      }

      try {
        const res = await fetch(googleCheckUrl(u.email, u.displayName || ''), {
          method: 'POST',
          credentials: API_BASE ? 'include' : 'same-origin',
        });

        if (cancelled || myEpoch !== authEpochRef.current) return;

        let data: Record<string, unknown> = {};
        try {
          data = await res.json();
        } catch {
          data = { _error: 'Response was not valid JSON' };
        }
        console.log('Backend Response:', data);

        if (!res.ok) {
          alert(`เข้าใช้งานไม่ได้: ${JSON.stringify(data)}`);
          await logout();
          return;
        }

        if (cancelled || myEpoch !== authEpochRef.current) return;

        const rawTok = data.access_token;
        const token =
          typeof rawTok === 'string' && rawTok.length > 0
            ? rawTok
            : rawTok != null && String(rawTok).trim().length > 0
              ? String(rawTok).trim()
              : null;

        if (data.access_token == null || token == null || token === '') {
          alert(JSON.stringify(data));
          await logout();
          return;
        }

        if (cancelled || myEpoch !== authEpochRef.current) return;

        localStorage.setItem('rw_token', token);
        setRailwayToken(token);
        setUser(u);
      } catch (e) {
        console.error('Connection failed:', e);
        if (myEpoch === authEpochRef.current) {
          const net =
            e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
          alert(`ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ${net}`);
          await logout();
        }
      } finally {
        if (!cancelled && myEpoch === authEpochRef.current) {
          setAuthGateReady(true);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Data Listeners
  useEffect(() => {
    if (!user) return;

    // User Data
    const userUnsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      setUserData(snap.data());
    });

    // Scans
    const scansUnsub = onSnapshot(
      query(collection(db, 'users', user.uid, 'scans'), orderBy('timestamp', 'desc'), limit(1)),
      (snap) => {
        if (!snap.empty) {
          const data = snap.docs[0].data();
          // If we clear UI on refresh, ignore historical scan docs.
          if (CLEAR_UI_ON_REFRESH) {
            const cts = (data as any)?.clientTs;
            if (typeof cts !== 'number' || cts < sessionStartRef.current) return;
          }
          // Merge to avoid "ghosting" away local-only fields like the last uploaded image preview.
          setLatestScan((prev: any) => ({
            ...(data as any),
            uploadedImageDataUrl:
              (data as any)?.uploadedImageDataUrl ??
              prev?.uploadedImageDataUrl ??
              null,
            analysisDetailed:
              (data as any)?.analysisDetailed ??
              prev?.analysisDetailed ??
              null,
          }));
        }
      }
    );

    // Chat
    const chatUnsub = onSnapshot(
      query(collection(db, 'users', user.uid, 'chat'), orderBy('timestamp', 'asc'), limit(50)),
      (snap) => {
        const rows = snap.docs.map(d => d.data());
        if (!CLEAR_UI_ON_REFRESH) {
          setChatMessages(rows);
          return;
        }
        // Keep only messages created in this session (after refresh)
        setChatMessages(
          rows.filter((m: any) => typeof m?.clientTs === 'number' && m.clientTs >= sessionStartRef.current)
        );
      }
    );

    // Fatigue
    const fatigueUnsub = onSnapshot(doc(db, 'users', user.uid, 'mental_health', 'current'), (snap) => {
      if (snap.exists()) setFatigueData(snap.data() as any);
    });

    return () => {
      userUnsub();
      scansUnsub();
      chatUnsub();
      fatigueUnsub();
    };
  }, [user]);

  const visibleChatMessages = chatMessages.filter((m) => {
    const c = (m as any)?.content;
    return !(m?.role === 'model' && typeof c === 'string' && c.startsWith('Chat Error:'));
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0 || !user || !railwayToken) return;

    setIsScanning(true);
    const file = acceptedFiles[0];

    try {
      // Create a local preview for the latest uploaded image (used in 5-D tab).
      const uploadedImageDataUrl: string = await new Promise((resolve) => {
        try {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
        } catch {
          resolve('');
        }
      });

      const result = await callAnalyze(file, railwayToken);
      console.log('Analysis Result:', result);
      // Backend shape may vary slightly; normalize the analysis payload.
      const analysis =
        (result?.analysis as any) ??
        (result?.json_block as any) ??
        (result?.jsonBlock as any) ??
        {};
      const detailed = normalizeDetailedAnalysis(analysis);
      const scoreOnly = (result?.scores as any) || null;

      // IMPORTANT: Update UI immediately even if Firestore write fails (permission/RLS).
      // latestScan is what drives the Radar Chart + dashboard panels.
      const uiScan = {
        analysisDetailed: detailed,
        uploadedImageDataUrl,
        clientTs: sessionClientTs,
        dimensions: {
          logic: getDimScore(scoreOnly?.Logic ?? analysis?.Logic),
          literacy: getDimScore(scoreOnly?.Accuracy ?? analysis?.Accuracy),
          precision: getDimScore(scoreOnly?.Analysis ?? analysis?.Analysis),
          higherOrder: getDimScore(scoreOnly?.Application ?? analysis?.Application),
          synthesis: getDimScore(scoreOnly?.Connectivity ?? analysis?.Connectivity)
        },
        topic: result?.topic || "วิเคราะห์อัตโนมัติ",
        careerInsight: result?.careerInsight || "",
        prerequisiteCorrelation: result?.prerequisiteCorrelation || "",
        // Use a client-side timestamp for immediate rendering; Firestore will later write serverTimestamp() if allowed.
        timestamp: new Date(),
        userId: user.uid
      };
      setLatestScan(uiScan);

      // Update local 5-D history immediately (even if DB writes fail).
      setCompetencyLogs((prev) => [
        {
          created_at: new Date().toISOString(),
          topic: uiScan.topic,
          logic_score: uiScan.dimensions.logic,
          accuracy_score: uiScan.dimensions.literacy,
          analysis_score: uiScan.dimensions.precision,
          application_score: uiScan.dimensions.higherOrder,
          connectivity_score: uiScan.dimensions.synthesis,
        },
        ...prev,
      ]);

      // Optional: auto-navigate to 5-D tab after a successful scan
      if (AUTO_TAB_AFTER_SCAN) {
        setActiveTab('competency');
      }

      // Save to Firestore
      try {
        await addDoc(collection(db, 'users', user.uid, 'scans'), {
          // Persist detailed AI reasons so the 5-D tab doesn't lose them when the snapshot listener updates latestScan.
          analysisDetailed: uiScan.analysisDetailed,
          // NOTE: we intentionally do NOT store uploadedImageDataUrl in Firestore (size risk).
          clientTs: uiScan.clientTs,
          dimensions: uiScan.dimensions,
          topic: uiScan.topic,
          careerInsight: uiScan.careerInsight,
          prerequisiteCorrelation: uiScan.prerequisiteCorrelation,
          timestamp: serverTimestamp(),
          userId: user.uid
        });
      } catch (e) {
        // Permission errors should not block the UI from showing the latest scan.
        console.warn('Firestore save failed (scan):', e);
      }

      // Trigger fatigue check
      const fatigue = await callFatigue(`Recent scan: ${result.topic}. Results: ${JSON.stringify(analysis)}`);
      await setDoc(doc(db, 'users', user.uid, 'mental_health', 'current'), {
        ...fatigue,
        updatedAt: serverTimestamp()
      });

      // Refresh Supabase-backed history/profile (best-effort).
      try {
        const data = await callStudentData(railwayToken);
        setCompetencyLogs(Array.isArray(data?.logs) ? data.logs : []);
        setStudentAggregates((data?.aggregates as any) ?? {});
      } catch (e) {
        console.warn('Failed to refresh /api/student/data:', e);
      }
      try {
        const prof = await callStudentProfile(railwayToken);
        setStudentProfile((prof?.profile as any) ?? null);
      } catch (e) {
        console.warn('Failed to refresh /api/student/profile:', e);
      }

      setIsScanning(false);
    } catch (error) {
      console.error('Scan Error:', error);
      const msg =
        error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
      alert(`อัปโหลด/วิเคราะห์ไม่สำเร็จ: ${msg}`);
      setIsScanning(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [] },
    multiple: false
  } as any);

  const handleSendMessage = async () => {
    if (!pendingMessage.trim() || !user || isTyping) return;
    const msg = pendingMessage;
    setPendingMessage('');
    setIsTyping(true);
    setChatError(null);

    try {
      await addDoc(collection(db, 'users', user.uid, 'chat'), {
        role: 'user',
        content: msg,
        clientTs: sessionClientTs,
        timestamp: serverTimestamp()
      });

      const history = visibleChatMessages.map(m => ({ role: m.role, content: m.content }));
      const scanContextObj = latestScan
        ? {
            topic: latestScan.topic ?? 'ไม่ทราบหัวข้อ',
            dimensions: latestScan.dimensions ?? {},
            analysisDetailed:
              normalizeDetailedAnalysis(latestScan?.analysisDetailed) ||
              normalizeDetailedAnalysis((latestScan as any)?.analysis) ||
              null,
            careerInsight: latestScan.careerInsight ?? '',
            prerequisiteCorrelation: latestScan.prerequisiteCorrelation ?? '',
          }
        : null;
      const scanContext = scanContextObj
        ? `ข้อมูลล่าสุดจากการสแกน (JSON): ${JSON.stringify(scanContextObj)}`
        : '';
      const historyWithContext = scanContext
        ? [{ role: 'system', content: scanContext }, ...history]
        : history;

      const aiResponse = await callChat(historyWithContext, msg);

      if (typeof aiResponse === 'string' && aiResponse.startsWith('Chat Error:')) {
        // Do not persist error messages as "assistant" chat bubbles (prevents UI ghosting).
        setChatError(aiResponse.replace(/^Chat Error:\s*/i, '').trim() || 'เกิดข้อผิดพลาดในการเรียกติวเตอร์');
        return;
      }

      setChatError(null);
      await addDoc(collection(db, 'users', user.uid, 'chat'), {
        role: 'model',
        content: aiResponse,
        clientTs: sessionClientTs,
        timestamp: serverTimestamp()
      });
    } catch (e) {
      console.error('Chat Error:', e);
      const msg =
        e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
      setChatError(msg || 'เกิดข้อผิดพลาดในการเรียกติวเตอร์');
    } finally {
      setIsTyping(false);
    }
  };

  // รอ Firebase + google-check ครั้งแรก — กันหน้า Login กระพริบ / loop ระหว่าง redirect
  if (!authGateReady) {
    return <ConnectingScreen />;
  }

  // ต้องมีทั้ง Firebase user และ JWT จาก backend (อย่างใดอย่างหนึ่งหาย = ยังไม่เข้าระบบ)
  const sessionComplete = Boolean(user && railwayToken);
  if (!sessionComplete) {
    return <LoginScreen onLogin={loginWithGoogle} />;
  }

  const radarData = latestScan ? [
    { subject: 'Logic (TIMSS)', value: latestScan.dimensions.logic },
    { subject: 'Literacy (PISA)', value: latestScan.dimensions.literacy },
    { subject: 'Precision (Common Core)', value: latestScan.dimensions.precision },
    { subject: 'Higher-order (Bloom)', value: latestScan.dimensions.higherOrder },
    { subject: 'Synthesis', value: latestScan.dimensions.synthesis },
  ] : DEFAULT_DIMENSIONS;

  const userReadinessPct = latestScan
    ? clampPct(
        readinessFromScores({
          Logic: latestScan?.dimensions?.logic ?? 0,
          Accuracy: latestScan?.dimensions?.literacy ?? 0,
          Analysis: latestScan?.dimensions?.precision ?? 0,
          Application: latestScan?.dimensions?.higherOrder ?? 0,
          Connectivity: latestScan?.dimensions?.synthesis ?? 0,
        })
      )
    : null;

  const roomAvgPct = studentAggregates?.room_readiness_avg != null ? clampPct(studentAggregates.room_readiness_avg) : null;
  const gradeAvgPct = studentAggregates?.grade_readiness_avg != null ? clampPct(studentAggregates.grade_readiness_avg) : null;

  const avgFromLogs = (key: keyof CompetencyLog): number | null => {
    const vals = competencyLogs
      .map((l) => (typeof l?.[key] === 'number' ? (l[key] as number) : null))
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const avgScores = {
    Logic: avgFromLogs('logic_score'),
    Accuracy: avgFromLogs('accuracy_score'),
    Analysis: avgFromLogs('analysis_score'),
    Application: avgFromLogs('application_score'),
    Connectivity: avgFromLogs('connectivity_score'),
  };
  const careerReadinessAvgPct =
    avgScores.Logic != null ||
    avgScores.Accuracy != null ||
    avgScores.Analysis != null ||
    avgScores.Application != null ||
    avgScores.Connectivity != null
      ? clampPct(
          readinessFromScores({
            Logic: avgScores.Logic ?? 0,
            Accuracy: avgScores.Accuracy ?? 0,
            Analysis: avgScores.Analysis ?? 0,
            Application: avgScores.Application ?? 0,
            Connectivity: avgScores.Connectivity ?? 0,
          })
        )
      : null;

  return (
    <div className="h-screen w-screen overflow-hidden flex p-6 gap-6 relative bg-[#050505] text-white">
      {/* Background Blobs */}
      <div className="absolute top-[-100px] left-[-100px] w-[500px] h-[500px] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-150px] right-[-100px] w-[600px] h-[600px] rounded-full bg-purple-700/10 blur-[150px] pointer-events-none" />

      {/* Sidebar Glass Nav */}
      <aside className="w-72 flex flex-col gap-6 z-10">
        <header className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-400 to-indigo-500 flex items-center justify-center font-bold text-xl shadow-lg shadow-cyan-500/20 cursor-pointer" onClick={() => setActiveTab('dashboard')}>S</div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-tight text-white uppercase italic leading-none">SYNTHESIS <span className="text-cyan-400">AI</span></span>
            <span className="text-[10px] text-white/30 uppercase tracking-[0.2em] mt-1 font-light">Neural HUD v3.1</span>
          </div>
        </header>

        <nav className="flex flex-col gap-1">
          {[
            { id: 'dashboard', label: 'ศูนย์การเติบโต', icon: LayoutDashboard },
            { id: 'competency', label: '5-D Competency', icon: RadarIcon },
            { id: 'roadmap', label: 'เส้นทางอาชีพ', icon: Target },
            { id: 'tutor', label: 'Socratic Tutor', icon: Brain },
            { id: 'management', label: 'การตั้งค่า', icon: Settings },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as AppTab)}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all border border-transparent group ${activeTab === item.id
                ? 'bg-white/10 border-white/10 shadow-xl text-white'
                : 'text-white/40 hover:bg-white/5 hover:text-white/60'
                }`}
            >
              <item.icon size={18} className={activeTab === item.id ? 'text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]' : 'group-hover:text-cyan-400/50'} />
              <span className="text-xs font-semibold uppercase tracking-widest">{item.label}</span>
            </button>
          ))}
        </nav>

        {userData && (
          <div className="mt-auto glass-panel p-4 border border-white/5 space-y-4">
            <div className="flex justify-between items-center text-[10px] text-white/30 uppercase tracking-widest leading-none">
              <span className="flex items-center gap-2 text-white/60 font-bold"><UserIcon size={12} /> Profile Status</span>
              <button onClick={logout} className="text-white/20 hover:text-red-400 transition-colors"><LogOut size={12} /></button>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-white uppercase tracking-[0.1em]">{userData.name}</span>
              <span className="text-[9px] text-white/40 uppercase tracking-widest">{userData.email}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col gap-6 z-10 min-w-0">
        <header className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-extralight tracking-tight mb-1 text-white uppercase italic">
              แท็บ: <span className="font-normal text-white/90">{activeTab}</span>
            </h1>
            <p className="text-white/30 text-[10px] uppercase tracking-[0.2em] font-light">Node: {user?.uid.slice(0, 8)} | Domain: RW-AI-Secure</p>
          </div>
          <div className="flex items-center gap-4 bg-white/5 rounded-full px-4 py-2 border border-white/5 backdrop-blur-3xl shadow-2xl">
            <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-widest border-r border-white/10 pr-4 font-bold">
              <Heart size={12} className={`text-red-400 ${fatigueData.status === 'CRITICAL' ? 'animate-ping' : 'animate-pulse'}`} />
              สถานะ: <span className={fatigueData.status === 'CRITICAL' ? 'text-red-400' : 'text-emerald-400'}>{fatigueData.status}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-widest font-bold">
              <ShieldCheck size={12} className="text-cyan-400" />
              ข้อมูล: <span className="text-white/60">เข้ารหัส</span>
            </div>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-12 gap-6 overflow-hidden min-h-0">
          {/* Main Workspace (Tabs) */}
          <div className="col-span-8 flex flex-col gap-6 min-h-0">
            {activeTab === 'dashboard' && (
              <div className="flex-1 flex flex-col gap-6 min-h-0 overflow-y-auto pr-2 custom-scrollbar">
                {/* Neural Scanner Interface */}
                <div className="glass-panel min-h-[440px] flex flex-col relative overflow-hidden">
                  <div className="dot-grid" />
                  <div className="relative z-10 p-6 h-full flex flex-col">
                    <h3 className="text-[10px] uppercase tracking-[0.4em] mb-6 flex items-center gap-2 text-white/40 italic font-bold">
                      <Scan size={14} className="text-cyan-400" /> Competency Vector Mapping
                    </h3>

                    <div className="flex-1 flex flex-col min-h-0">
                      <AnimatePresence mode="wait">
                        {isScanning ? (
                          <motion.div
                            key="scanning"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col items-center justify-center bg-black/40 rounded-3xl relative overflow-hidden"
                          >
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <motion.div animate={{ y: [0, 440, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} className="absolute top-0 w-full h-[1px] bg-cyan-400 shadow-[0_0_20px_#22d3ee] z-10" />
                              <Activity className="text-cyan-400 animate-pulse mb-6" size={48} />
                              <span className="text-[10px] tracking-[0.4em] text-cyan-400 uppercase font-black">กำลังสแกนและประมวลผล...</span>
                            </div>
                          </motion.div>
                        ) : latestScan ? (
                          <motion.div
                            key="result"
                            initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
                            className="flex-1 flex flex-col gap-6"
                          >
                            <div className="flex gap-4">
                              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex-1 backdrop-blur-xl">
                                <div className="flex justify-between items-center mb-2">
                                  <span className="text-[10px] text-white/30 uppercase font-bold">หัวข้อที่ตรวจพบ</span>
                                  <span className="text-xs text-white font-mono bg-white/5 px-2 py-0.5 rounded italic">{latestScan.topic}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-white/30 uppercase font-bold">สถานะความมั่นใจ</span>
                                  <span className="text-xs font-mono font-bold text-emerald-400">
                                    ยืนยันแล้ว
                                  </span>
                                </div>
                              </div>
                              <button
                                {...getRootProps()}
                                className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-1 transition-all group px-8"
                              >
                                <input {...getInputProps()} />
                                <Upload size={16} className="text-cyan-400 group-hover:scale-110 transition-transform" />
                                <span className="text-[8px] uppercase tracking-widest text-white/40 font-bold">สแกนใหม่</span>
                              </button>
                            </div>

                            <div className="flex-1 grid grid-cols-2 gap-6 min-h-0">
                              <div className="bg-black/40 rounded-3xl border border-white/5 p-4 flex flex-col overflow-hidden relative shadow-inner">
                                <div className="dot-grid opacity-[0.05]" />
                                <h4 className="text-[10px] text-white/20 uppercase mb-4 relative z-10 font-bold tracking-widest italic">Spider Graph: 5-D Competency</h4>
                                <div className="relative z-10 h-[350px]">
                                  <Radar5DChart data={radarData} name={user.displayName || 'Student'} heightPx={350} />
                                </div>
                              </div>
                              <div className="space-y-4 overflow-y-auto pr-1 flex flex-col custom-scrollbar">
                                <div className="p-4 bg-white/5 rounded-2xl border-l-[3px] border-indigo-500/60 backdrop-blur-2xl">
                                  <h5 className="text-[10px] text-indigo-400 uppercase font-black mb-2 flex items-center gap-2 tracking-[0.2em]">
                                    <Workflow size={12} /> Neural Trace Insight
                                  </h5>
                                  <p className="text-[11px] text-white/70 leading-relaxed uppercase tracking-tight italic">
                                    {latestScan.prerequisiteCorrelation || 'ยังไม่มีข้อมูลเชิงลึกจาก AI'}
                                  </p>
                                </div>
                                <div className="p-4 bg-white/5 rounded-2xl border-l-[3px] border-cyan-500/60 backdrop-blur-2xl">
                                  <h5 className="text-[10px] text-cyan-400 uppercase font-black mb-2 flex items-center gap-2 tracking-[0.2em]">
                                    <TrendingUp size={12} /> Temporal Trajectory
                                  </h5>
                                  <p className="text-[11px] text-white/70 leading-relaxed uppercase tracking-tight italic font-medium">
                                    {latestScan.careerInsight || 'ยังไม่มีแนวโน้มการพัฒนาจาก AI'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </motion.div>
      ) : (
        <div {...getRootProps()} className="flex-1 flex flex-col">
          <motion.div 
            className={`flex-1 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center cursor-pointer transition-all group overflow-hidden relative ${isDragActive ? 'border-cyan-400 bg-cyan-400/5' : 'border-white/5 hover:border-cyan-400/40'}`}
          >
            <input {...getInputProps()} />
            <div className="absolute inset-0 bg-white/0 group-hover:bg-cyan-400/5 transition-colors" />
            <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform relative z-10 shadow-2xl">
              <Upload className="text-white/30 group-hover:text-cyan-400" size={32} />
            </div>
            <span className="text-[10px] tracking-[0.4em] text-white/30 uppercase group-hover:text-white/80 transition-colors relative z-10 font-black italic">อัปโหลดเพื่อเริ่มสแกน</span>
            <p className="text-[8px] text-white/10 uppercase tracking-widest mt-2 relative z-10">รองรับไฟล์รูปภาพทุกชนิด</p>
          </motion.div>
        </div>
      )}
                      </AnimatePresence>  
                    </div>
                  </div>
                </div>

                {/* Secondary Insights */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="glass-panel p-6">
                    <h3 className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold italic mb-6">เสถียรภาพเวกเตอร์รายวิชา</h3>
                    <div className="grid grid-cols-5 gap-4">
                      {['Math', 'Phy', 'Bio', 'Eng', 'CS'].map((subj, idx) => (
                        <div key={subj} className="flex flex-col items-center gap-2">
                          <div className="w-full h-24 bg-white/5 rounded-2xl relative overflow-hidden flex items-end justify-center group">
                            <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors" />
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: `${latestScan ? [85, 45, 60, 92, 70][idx] : 0}%` }}
                              className="w-full bg-cyan-400/10 border-t border-cyan-400/40"
                            />
                            <span className="absolute top-2 text-[8px] text-white/30 font-black tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">{[85, 45, 60, 92, 70][idx]}%</span>
                          </div>
                          <span className="text-[9px] text-white/50 uppercase tracking-widest font-bold">{subj}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="glass-panel p-6 flex flex-col">
                    <div className="mb-8 flex justify-between items-center">
                      <div>
                        <h3 className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold italic">Sociometric Balance</h3>
                        <p className="text-[9px] text-white/20 uppercase tracking-[0.1em] font-light mt-1">
                          Room vs Grade vs You (Readiness)
                        </p>
                      </div>
                      <TrendingUp size={16} className="text-cyan-400/40" />
                    </div>
                    <div className="space-y-6 justify-center flex-1 flex flex-col">
                      <div className="space-y-2">
                        <div className="flex justify-between text-[8px] uppercase font-black tracking-[0.2em] text-white/30">
                          <span>Grade average</span>
                          <span>{gradeAvgPct != null ? `${gradeAvgPct.toFixed(1)}%` : 'N/A'}</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden shadow-inner">
                          <div className="h-full bg-white/10" style={{ width: `${gradeAvgPct ?? 0}%` }} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-[8px] uppercase font-black tracking-[0.2em] text-indigo-400/60">
                          <span>Room average</span>
                          <span>{roomAvgPct != null ? `${roomAvgPct.toFixed(1)}%` : 'N/A'}</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden shadow-inner border border-white/5">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${roomAvgPct ?? 0}%` }}
                            className="h-full bg-indigo-400/60 shadow-[0_0_15px_rgba(129,140,248,0.35)]"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-[8px] uppercase font-black tracking-[0.2em] text-cyan-400/60">
                          <span>You</span>
                          <span>{userReadinessPct != null ? `${userReadinessPct.toFixed(1)}%` : 'N/A'}</span>
                        </div>
                        <div className="h-1.5 bg-white/5 shadow-inner rounded-full overflow-hidden border border-white/5">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${userReadinessPct ?? 0}%` }}
                            className="h-full bg-cyan-400 shadow-[0_0_15px_#22d3ee] opacity-80"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'tutor' && (
              <div className="flex-1 glass-panel flex flex-col overflow-hidden relative">
                <div className="dot-grid" />
                <div className="relative z-10 flex flex-col h-full p-6">
                  <header className="border-b border-white/5 pb-6 mb-6 flex justify-between items-center -mx-6 -mt-6 p-6 bg-black/20 rounded-t-[32px] backdrop-blur-3xl">
                    <div>
                      <h3 className="text-xs uppercase font-black tracking-[0.3em] italic text-white/90">
                        Socratic Tutor
                      </h3>
                      <p className="text-[10px] text-cyan-400/60 italic uppercase tracking-wider font-bold mt-1">
                        สแกนล่าสุด: {latestScan?.topic || 'ยังไม่มี'} | ความพร้อม:{' '}
                        {userReadinessPct != null ? `${userReadinessPct.toFixed(1)}%` : 'N/A'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="px-4 py-2 bg-cyan-400/10 text-cyan-400 border border-cyan-400/30 text-[9px] rounded-2xl uppercase font-black tracking-widest shadow-lg shadow-cyan-400/5">
                        สถานะ: พร้อมติว
                      </span>
                    </div>
                  </header>

                  <div className="flex-1 overflow-y-auto space-y-6 mb-4 pr-2 custom-scrollbar">
                    {visibleChatMessages.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full opacity-20 gap-4">
                        <Brain size={48} className="animate-pulse" />
                        <p className="text-[10px] uppercase font-black tracking-[0.4em] italic text-center leading-loose">
                          อัปโหลดรูปในหน้า Dashboard
                          <br />
                          เพื่อเริ่มการติวแบบเฉพาะบุคคล
                        </p>
                      </div>
                    )}

                    {visibleChatMessages.map((m, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: m.role === 'user' ? 20 : -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''} max-w-[90%] ${m.role === 'user' ? 'ml-auto' : ''}`}
                      >
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${m.role === 'user' ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-cyan-400/10 border-cyan-400/30 shadow-2xl'}`}>
                          {m.role === 'user' ? <UserIcon size={18} className="text-indigo-400" /> : <Sparkles size={18} className="text-cyan-400" />}
                        </div>
                        <div className={`rounded-3xl p-5 border shadow-2xl backdrop-blur-3xl ${m.role === 'user' ? 'bg-white/5 border-white/10 rounded-tr-none' : 'bg-white/5 border-white/20 rounded-tl-none relative'}`}>
                          {m.role === 'model' && <div className="absolute top-2 right-4 opacity-5"><Brain size={48} /></div>}
                          <p className="text-sm leading-relaxed text-white/80 font-medium whitespace-pre-wrap">
                            {m.content}
                          </p>
                        </div>
                      </motion.div>
                    ))}

                    {isTyping && (
                      <div className="flex gap-4 max-w-[90%]">
                        <div className="w-10 h-10 rounded-2xl bg-cyan-400/10 flex items-center justify-center shrink-0 border border-cyan-400/30">
                          <Sparkles size={18} className="text-cyan-400 animate-pulse" />
                        </div>
                        <div className="bg-white/5 rounded-3xl rounded-tl-none p-5 border border-white/20 flex gap-1">
                          <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                          <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                          <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {chatError && (
                    <div className="mb-3 text-[11px] text-red-300/90 border border-red-500/20 bg-red-500/10 rounded-2xl p-3">
                      ข้อผิดพลาด: {chatError}
                    </div>
                  )}

                  <div className="mt-auto flex items-center gap-3 bg-[#0a0a0a] rounded-[28px] p-2 border border-white/5 focus-within:border-cyan-400/40 shadow-2xl transition-all group backdrop-blur-3xl">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white/10 group-focus-within:text-cyan-400 transition-colors">
                      <MessageSquare size={20} />
                    </div>
                    <input
                      type="text"
                      value={pendingMessage}
                      onChange={(e) => setPendingMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="พิมพ์คำถามของคุณที่นี่..."
                      className="flex-1 bg-transparent border-none outline-none px-2 text-sm text-white placeholder:text-white/10 tracking-widest font-medium"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!pendingMessage.trim() || isTyping}
                      className="w-10 h-10 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/20 transition-all active:scale-95 disabled:opacity-20 disabled:grayscale"
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'roadmap' && (
              <div className="flex-1 glass-panel flex flex-col overflow-hidden relative p-6">
                <div className="dot-grid opacity-[0.03]" />

                <header className="relative z-10 mb-6 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs uppercase font-black tracking-[0.3em] italic text-white/90 flex items-center gap-2">
                      <Target size={14} className="text-cyan-400" /> Roadmap
                    </h3>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider font-bold mt-1">
                      Career readiness based on your real competency history
                    </p>
                  </div>
                  <span className="px-4 py-2 bg-cyan-400/10 text-cyan-400 border border-cyan-400/30 text-[9px] rounded-2xl uppercase font-black tracking-widest shadow-lg shadow-cyan-400/5">
                    {isStudentDataLoading ? 'LOADING' : competencyLogs.length > 0 ? 'LIVE' : 'NO DATA'}
                  </span>
                </header>

                <div className="relative z-10 grid grid-cols-2 gap-6 flex-1 min-h-0">
                  <div className="bg-black/40 rounded-3xl border border-white/5 p-4 flex flex-col overflow-hidden shadow-inner">
                    <h4 className="text-[10px] text-white/20 uppercase mb-4 font-bold tracking-widest italic">
                      5-D Average Snapshot
                    </h4>
                    <Radar5DChart
                      data={
                        competencyLogs.length > 0
                          ? [
                              { subject: 'Logic (TIMSS)', value: avgScores.Logic ?? 0 },
                              { subject: 'Literacy (PISA)', value: avgScores.Accuracy ?? 0 },
                              { subject: 'Precision (Common Core)', value: avgScores.Analysis ?? 0 },
                              { subject: 'Higher-order (Bloom)', value: avgScores.Application ?? 0 },
                              { subject: 'Synthesis', value: avgScores.Connectivity ?? 0 }
                            ]
                          : radarData
                      }
                      name={user?.displayName || 'Student'}
                      heightPx={260}
                    />
                  </div>

                  <div className="space-y-4 overflow-y-auto pr-1 flex flex-col custom-scrollbar">
                    <div className="p-4 bg-white/5 rounded-2xl border-l-[3px] border-cyan-500/60 backdrop-blur-2xl">
                      <h5 className="text-[10px] text-cyan-400 uppercase font-black mb-2 tracking-[0.2em]">
                        Career Readiness %
                      </h5>
                      <p className="text-4xl font-thin tracking-tighter text-cyan-400 italic">
                        {careerReadinessAvgPct != null ? `${careerReadinessAvgPct.toFixed(1)}%` : 'N/A'}
                      </p>
                      <p className="text-[10px] text-white/30 uppercase tracking-wider mt-2">
                        Formula: Logic×0.40 + Analysis×0.30 + Application×0.15 + Accuracy×0.10 + Connectivity×0.05
                      </p>
                    </div>

                    <div className="p-4 bg-white/5 rounded-2xl border-l-[3px] border-indigo-500/60 backdrop-blur-2xl">
                      <h5 className="text-[10px] text-indigo-400 uppercase font-black mb-2 tracking-[0.2em]">
                        Latest Scan
                      </h5>
                      <p className="text-[11px] text-white/70 leading-relaxed uppercase tracking-tight italic">
                        Topic: {latestScan?.topic || 'Unknown'} | Readiness:{' '}
                        {userReadinessPct != null ? `${userReadinessPct.toFixed(1)}%` : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'competency' && (
              <div className="flex-1 glass-panel flex flex-col overflow-hidden relative p-6">
                <div className="dot-grid opacity-[0.03]" />
                <header className="relative z-10 mb-6 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs uppercase font-black tracking-[0.3em] italic text-white/90 flex items-center gap-2">
                      <RadarIcon size={14} className="text-cyan-400" /> 5-D Competency
                    </h3>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider font-bold mt-1">
                      Latest scan with detailed AI feedback
                    </p>
                  </div>
                  <span className="text-[9px] uppercase font-black tracking-widest text-white/30">
                    {latestScan ? 'LIVE' : isStudentDataLoading ? 'Loading…' : 'NO DATA'}
                  </span>
                </header>

                {!latestScan ? (
                  <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center text-white/30 text-[10px] uppercase tracking-[0.3em]">
                    No scan yet — upload an image on the Dashboard.
                  </div>
                ) : (
                  <div className="relative z-10 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2 space-y-6">
                    {/* Top: Radar */}
                    <div className="bg-black/30 border border-white/5 rounded-3xl p-5 overflow-hidden">
                      <div className="flex items-start justify-between mb-4 gap-4">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
                            Latest scan
                          </div>
                          <div className="text-[12px] text-white/80 mt-1">
                            Topic: <span className="text-white/90">{latestScan?.topic || 'Unknown'}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-widest text-white/30 font-bold">Readiness</div>
                          <div className="text-3xl font-thin tracking-tighter text-cyan-400 italic">
                            {userReadinessPct != null ? `${userReadinessPct.toFixed(1)}%` : 'N/A'}
                          </div>
                        </div>
                      </div>

                      <div className="h-[350px]">
                        <Radar5DChart data={radarData} name={user?.displayName || 'Student'} heightPx={350} />
                      </div>
                    </div>

                    {/* Bottom: Feedback Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {(() => {
                        const d: DetailedAnalysis =
                          normalizeDetailedAnalysis(latestScan?.analysisDetailed) ||
                          normalizeDetailedAnalysis((latestScan as any)?.analysis) ||
                          ({
                            Logic: { score: latestScan?.dimensions?.logic ?? 0, reason: '' },
                            Accuracy: { score: latestScan?.dimensions?.literacy ?? 0, reason: '' },
                            Analysis: { score: latestScan?.dimensions?.precision ?? 0, reason: '' },
                            Application: { score: latestScan?.dimensions?.higherOrder ?? 0, reason: '' },
                            Connectivity: { score: latestScan?.dimensions?.synthesis ?? 0, reason: '' },
                          } as DetailedAnalysis);

                        const cards: Array<{
                          key: DimensionKey;
                          title: string;
                          icon: any;
                          accent: string;
                        }> = [
                          { key: 'Logic', title: 'Logic (TIMSS)', icon: Brain, accent: 'border-cyan-400/30 text-cyan-300' },
                          { key: 'Accuracy', title: 'Accuracy (Common Core)', icon: ShieldCheck, accent: 'border-emerald-400/30 text-emerald-300' },
                          { key: 'Analysis', title: 'Analysis (Bloom)', icon: Search, accent: 'border-indigo-400/30 text-indigo-300' },
                          { key: 'Application', title: 'Application (PISA)', icon: Target, accent: 'border-purple-400/30 text-purple-300' },
                          { key: 'Connectivity', title: 'Connectivity', icon: Workflow, accent: 'border-amber-400/30 text-amber-300' },
                        ];

                        return cards.map((c) => {
                          const Icon = c.icon;
                          const score = clampPct(d[c.key]?.score ?? 0);
                          const reason = (d[c.key]?.reason || '').trim();
                          return (
                            <div
                              key={c.key}
                              className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-3xl p-5 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
                            >
                              <div className="absolute inset-0 pointer-events-none opacity-30">
                                <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-cyan-400/10 blur-3xl" />
                                <div className="absolute -bottom-12 -left-10 w-44 h-44 rounded-full bg-indigo-400/10 blur-3xl" />
                              </div>

                              <div className="relative z-10 flex items-start justify-between gap-4">
                                <div className="flex items-start gap-3">
                                  <div className={`w-10 h-10 rounded-2xl border ${c.accent} bg-white/5 flex items-center justify-center`}>
                                    <Icon size={18} />
                                  </div>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold">
                                      Dimension
                                    </div>
                                    <div className="text-sm text-white/90 font-semibold tracking-tight">
                                      {c.title}
                                    </div>
                                  </div>
                                </div>

                                <div className="shrink-0">
                                  <span className="inline-flex items-center justify-center px-3 py-1 rounded-2xl bg-black/40 border border-white/10 text-[10px] uppercase tracking-widest font-black text-white/80">
                                    {score.toFixed(0)}
                                  </span>
                                </div>
                              </div>

                              <div className="relative z-10 mt-4 text-[12px] text-white/70 leading-relaxed">
                                {reason ? (
                                  reason
                                ) : (
                                  <span className="text-white/30">
                                    Waiting for AI feedback reasons (Thai). Please run a new scan.
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                    {/* Latest Uploaded Image (bottom) */}
                    {(latestScan as any)?.uploadedImageDataUrl ? (
                      <div className="bg-black/30 border border-white/5 rounded-3xl p-5 overflow-hidden">
                        <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3">
                          รูปล่าสุดที่อัปโหลด
                        </div>
                        <img
                          src={(latestScan as any).uploadedImageDataUrl}
                          alt="latest uploaded"
                          className="w-full max-h-[420px] object-contain rounded-2xl border border-white/10 bg-black/40"
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'management' && (
              <div className="flex-1 glass-panel flex flex-col overflow-hidden relative p-6">
                <div className="dot-grid opacity-[0.03]" />
                <header className="relative z-10 mb-6 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs uppercase font-black tracking-[0.3em] italic text-white/90 flex items-center gap-2">
                      <Settings size={14} className="text-cyan-400" /> Settings
                    </h3>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider font-bold mt-1">
                      Student profile from students + schools
                    </p>
                  </div>
                  <span className="text-[9px] uppercase font-black tracking-widest text-white/30">
                    {isStudentDataLoading ? 'Loading…' : 'Ready'}
                  </span>
                </header>

                <div className="relative z-10 grid grid-cols-2 gap-6 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2">
                  <div className="bg-black/30 border border-white/5 rounded-2xl p-5">
                    <h4 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4">
                      Student
                    </h4>
                    <div className="space-y-2 text-[12px] text-white/80">
                      <div><span className="text-white/30">Name:</span> {studentProfile?.name || user?.displayName || 'N/A'}</div>
                      <div><span className="text-white/30">Email:</span> {studentProfile?.email || user?.email || 'N/A'}</div>
                      <div><span className="text-white/30">Grade:</span> {studentProfile?.grade || 'N/A'}</div>
                      <div><span className="text-white/30">Room:</span> {studentProfile?.room || 'N/A'}</div>
                    </div>
                  </div>

                  <div className="bg-black/30 border border-white/5 rounded-2xl p-5">
                    <h4 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4">
                      School
                    </h4>
                    <div className="space-y-2 text-[12px] text-white/80">
                      <div><span className="text-white/30">Name:</span> {studentProfile?.school?.name || 'N/A'}</div>
                      <div><span className="text-white/30">Domain:</span> {studentProfile?.school?.domain || 'N/A'}</div>
                      <div><span className="text-white/30">School ID:</span> {String(studentProfile?.school?.id || 'N/A')}</div>
                    </div>
                  </div>

                  <div className="bg-black/30 border border-white/5 rounded-2xl p-5 col-span-2">
                    <h4 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4">
                      Sociometric context
                    </h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-white/5 rounded-2xl p-4">
                        <div className="text-[9px] text-white/30 uppercase tracking-widest font-bold">Grade avg</div>
                        <div className="text-2xl font-thin text-white/90 italic">
                          {gradeAvgPct != null ? `${gradeAvgPct.toFixed(1)}%` : 'N/A'}
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-2xl p-4">
                        <div className="text-[9px] text-white/30 uppercase tracking-widest font-bold">Room avg</div>
                        <div className="text-2xl font-thin text-white/90 italic">
                          {roomAvgPct != null ? `${roomAvgPct.toFixed(1)}%` : 'N/A'}
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-2xl p-4">
                        <div className="text-[9px] text-white/30 uppercase tracking-widest font-bold">You</div>
                        <div className="text-2xl font-thin text-cyan-400 italic">
                          {userReadinessPct != null ? `${userReadinessPct.toFixed(1)}%` : 'N/A'}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-[10px] text-white/30 uppercase tracking-wider">
                      Grade/Room values require grade & room columns in students table and RLS permissions that allow cohort aggregation.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Summary Column */}
          <div className="col-span-4 flex flex-col gap-6 h-full min-h-0">
            {/* College Matching Engine */}
            <div className="glass-panel flex flex-col relative shrink-0 p-6 overflow-hidden">
              <div className="dot-grid opacity-[0.02]" />
              <h3 className="text-[10px] mb-10 flex items-center gap-2 text-white/40 relative z-10 font-black uppercase tracking-[0.4em] italic">
                <Target size={14} className="text-cyan-400" /> ระบบจับคู่อาชีพ
              </h3>
              <div className="space-y-12 relative z-10 mb-4">
                <div className="relative group">
                  <div className="flex justify-between items-end mb-4">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-black text-white/90 uppercase tracking-widest italic">Eng @ KMITL</span>
                      <span className="text-[9px] text-white/20 uppercase tracking-[0.2em] mt-2 font-bold">Priority Vector 01</span>
                    </div>
                    <div className="text-right">
                      <span className="text-4xl font-thin tracking-tighter text-cyan-400 italic shadow-cyan-400/20">
                        {careerReadinessAvgPct != null
                          ? `${careerReadinessAvgPct.toFixed(1)}%`
                          : userReadinessPct != null
                            ? `${userReadinessPct.toFixed(1)}%`
                            : '??%'}
                      </span>
                      <span className="block text-[8px] uppercase tracking-[0.3em] text-cyan-400/60 font-black mt-1">ความพร้อม</span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden shadow-inner border border-white/5">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${careerReadinessAvgPct ?? userReadinessPct ?? 0}%` }}
                      transition={{ duration: 1.5, ease: "easeOut" }}
                      className="h-full bg-gradient-to-r from-cyan-400 to-indigo-600 shadow-[0_0_20px_rgba(34,211,238,0.6)]"
                    />
                  </div>
                </div>

                <div className="relative group opacity-40 hover:opacity-100 transition-opacity">
                  <div className="flex justify-between items-end mb-4">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-black text-white/80 uppercase tracking-widest italic leading-none">DS @ Chula</span>
                      <span className="text-[9px] text-white/20 uppercase tracking-[0.2em] mt-2 font-bold">Secondary Prediction</span>
                    </div>
                    <div className="text-right">
                      <span className="text-3xl font-thin tracking-tighter text-indigo-400/80 italic">
                        {roomAvgPct != null
                          ? `${roomAvgPct.toFixed(1)}%`
                          : gradeAvgPct != null
                            ? `${gradeAvgPct.toFixed(1)}%`
                            : '??%'}
                      </span>
                      <span className="block text-[8px] uppercase tracking-[0.3em] text-indigo-400/40 font-black mt-1">ความเป็นไปได้</span>
                    </div>
                  </div>
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden border border-white/5">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${roomAvgPct ?? gradeAvgPct ?? 0}%` }}
                      transition={{ duration: 2 }}
                      className="h-full bg-gradient-to-r from-indigo-400 to-purple-600"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-8 border-t border-white/5 relative z-10">
                <h4 className="text-[9px] uppercase tracking-[0.5em] text-white/20 mb-6 font-black italic">สรุปคำแนะนำ</h4>
                <ul className="space-y-6">
                  <li className="flex items-start gap-3 group">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 shrink-0 shadow-[0_0_10px_rgba(52,211,153,0.8)] group-hover:scale-150 transition-transform" />
                    <span className="text-[11px] text-white/50 leading-relaxed uppercase tracking-widest font-medium italic group-hover:text-white/80 transition-colors">
                      {latestScan ? 'High Procedural Precision compensates for current abstraction gaps.' : 'Neural data insufficient for Oracle analysis.'}
                    </span>
                  </li>
                  <li className="flex items-start gap-3 group">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 shrink-0 shadow-[0_0_10px_rgba(34,211,238,0.8)] group-hover:scale-150 transition-transform" />
                    <span className="text-[11px] text-white/50 leading-relaxed uppercase tracking-widest font-medium italic group-hover:text-white/80 transition-colors">
                      {latestScan ? 'Projected readiness for TCAS Portfolio: GRADE A+ (OPTIMAL).' : 'Awaiting data ingestion...'}
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Holistic Safety Guard */}
            <div className={`glass-panel flex-1 relative min-h-0 flex flex-col p-6 overflow-hidden transition-colors duration-500 ${fatigueData.status === 'CRITICAL' ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/5'}`}>
              <div className="dot-grid opacity-[0.02]" />
              <h3 className={`font-black uppercase text-[10px] tracking-[0.4em] mb-8 flex items-center gap-2 relative z-10 italic transition-colors ${fatigueData.status === 'CRITICAL' ? 'text-red-400 shadow-red-500/20' : 'text-emerald-400 shadow-emerald-500/20'}`}>
                <AlertTriangle size={14} className={fatigueData.status === 'CRITICAL' ? 'animate-ping' : 'animate-pulse'} /> ระบบเฝ้าระวังภาวะล้า
              </h3>
              <div className="space-y-6 flex-1 flex flex-col relative z-10 px-0 pb-0 min-h-0">
                <div className={`rounded-3xl p-5 border shadow-2xl backdrop-blur-3xl transition-colors ${fatigueData.status === 'CRITICAL' ? 'bg-red-400/5 border-red-400/30' : 'bg-white/5 border-white/10'}`}>
                  <div className="flex justify-between items-center mb-4">
                    <span className={`text-[9px] uppercase font-black tracking-[0.3em] italic ${fatigueData.status === 'CRITICAL' ? 'text-red-200/60' : 'text-white/40'}`}>Cognitive Overload Index</span>
                    <span className={`text-xs font-mono font-black italic ${fatigueData.status === 'CRITICAL' ? 'text-red-400' : 'text-emerald-400'}`}>{fatigueData.status} ({fatigueData.overloadIndex}%)</span>
                  </div>
                  <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden shadow-inner border border-white/5">
                    <motion.div
                      animate={{ width: `${fatigueData.overloadIndex}%` }}
                      className={`h-full shadow-[0_0_20px] transition-colors ${fatigueData.status === 'CRITICAL' ? 'bg-red-500 shadow-red-500/50' : 'bg-emerald-400 shadow-emerald-400/50'}`}
                    />
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center text-center bg-black/20 rounded-3xl p-6 border border-white/5 min-h-0 shadow-inner group">
                  <div className="relative mb-8 group-hover:scale-110 transition-transform duration-500">
                    <Heart size={48} className={`mx-auto opacity-10 transition-colors ${fatigueData.status === 'CRITICAL' ? 'text-red-400' : 'text-emerald-400'}`} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Activity size={24} className={`transition-colors ${fatigueData.status === 'CRITICAL' ? 'text-red-400' : 'text-cyan-400/60'}`} />
                    </div>
                  </div>
                  <p className={`text-[10px] leading-[2.2] uppercase tracking-[0.2em] italic overflow-y-auto px-1 custom-scrollbar font-bold transition-colors ${fatigueData.status === 'CRITICAL' ? 'text-red-200/80' : 'text-white/50'}`}>
                    "{fatigueData.recommendation}"
                  </p>
                </div>

                <button className={`w-full py-4 rounded-2xl text-[10px] uppercase font-black tracking-[0.4em] border italic transition-all active:scale-[0.98] shadow-2xl backdrop-blur-3xl mt-auto ${fatigueData.status === 'CRITICAL' ? 'bg-red-500/20 text-red-100 border-red-500/40 hover:bg-red-500/30' : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10'}`}>
                  เริ่มโหมดรีเซ็ตสมาธิ
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Decorative Overlays */}
      <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-indigo-600/5 blur-[150px] -z-10 rounded-full" />
      <div className="fixed bottom-0 left-0 w-[300px] h-[300px] bg-cyan-400/5 blur-[100px] -z-10 rounded-full" />
      <div className="fixed top-[40%] left-[20%] w-[1px] h-full bg-white/5 -z-10" />
      <div className="fixed top-[40%] right-[20%] w-[1px] h-full bg-white/5 -z-10" />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.1);
        }
        .glass-panel {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(25px);
          -webkit-backdrop-filter: blur(25px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 32px;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
        }
        .dot-grid {
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
          background-size: 24px 24px;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
