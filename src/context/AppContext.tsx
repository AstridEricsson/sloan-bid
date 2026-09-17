import { createContext, useContext, useState, useRef, type ReactNode } from 'react';
import type { Course, Screen, ChatMessage } from '../types';
import { STUDENT, OBLIGATORY_COURSE } from '../data/courses';
import { generateAIResponse } from '../utils/aiCounselor';

interface AppState {
  screen: Screen;
  setScreen: (s: Screen) => void;
  addedCourses: Course[];
  addCourse: (c: Course) => void;
  removeCourse: (id: string) => void;
  needToHave: Course[];
  niceToHave: Course[];
  optional: Course[];
  setNeedToHave: (courses: Course[]) => void;
  setNiceToHave: (courses: Course[]) => void;
  setOptional: (courses: Course[]) => void;
  sacrificedFrom: Record<string, 'need' | 'nice' | 'optional'>;
  setSacrificedFrom: (map: Record<string, 'need' | 'nice' | 'optional'>) => void;
  isChatOpen: boolean;
  toggleChat: () => void;
  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  markActionsHandled: (msgId: string) => void;
  sectionOverrides: Record<string, string>;
  setSectionOverride: (courseId: string, sectionId: string) => void;
  removeSectionOverride: (courseId: string) => void;
  browseAddedIds: Set<string>;
  addBrowseAddedId: (id: string) => void;
  removeBrowseAddedId: (id: string) => void;
  clearBrowseAddedIds: () => void;
  student: typeof STUDENT;
}

const AppContext = createContext<AppState | null>(null);

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 'init',
    role: 'assistant',
    text: "Hi Astrid! I can help you think through your course priorities and schedule. What are your goals for this semester?",
  },
];

export function AppProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<Screen>('login');
  const [addedCourses, setAddedCourses] = useState<Course[]>([OBLIGATORY_COURSE]);
  const [needToHave, setNeedToHave] = useState<Course[]>([OBLIGATORY_COURSE]);
  const [niceToHave, setNiceToHave] = useState<Course[]>([]);
  const [optional, setOptional] = useState<Course[]>([]);
  const [sacrificedFrom, setSacrificedFrom] = useState<Record<string, 'need' | 'nice' | 'optional'>>({});
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, string>>({});
  const [browseAddedIds, setBrowseAddedIds] = useState<Set<string>>(new Set());

  // Refs for stale-closure prevention in setTimeout
  const needRef = useRef(needToHave);
  needRef.current = needToHave;
  const niceRef = useRef(niceToHave);
  niceRef.current = niceToHave;
  const optionalRef = useRef(optional);
  optionalRef.current = optional;
  const overridesRef = useRef(sectionOverrides);
  overridesRef.current = sectionOverrides;

  const addCourse = (c: Course) => {
    if (!addedCourses.find((x) => x.id === c.id)) {
      setAddedCourses((prev) => [...prev, c]);
    }
  };

  const removeCourse = (id: string) => {
    if (id === OBLIGATORY_COURSE.id) return; // can't remove obligatory
    setAddedCourses((prev) => prev.filter((c) => c.id !== id));
    setNeedToHave((prev) => prev.filter((c) => c.id !== id));
    setNiceToHave((prev) => prev.filter((c) => c.id !== id));
    setOptional((prev) => prev.filter((c) => c.id !== id));
    setSectionOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setBrowseAddedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const addBrowseAddedId = (id: string) => {
    setBrowseAddedIds((prev) => new Set(prev).add(id));
  };

  const clearBrowseAddedIds = () => setBrowseAddedIds(new Set());

  const removeBrowseAddedId = (id: string) => {
    setBrowseAddedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleChat = () => setIsChatOpen((v) => !v);

  const setSectionOverride = (courseId: string, sectionId: string) => {
    setSectionOverrides((prev) => ({ ...prev, [courseId]: sectionId }));
  };

  const removeSectionOverride = (courseId: string) => {
    setSectionOverrides((prev) => {
      const next = { ...prev };
      delete next[courseId];
      return next;
    });
  };

  const markActionsHandled = (msgId: string) => {
    setChatMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, actionsHandled: true } : m))
    );
  };

  const addChatMessage = (msg: ChatMessage) => {
    setChatMessages((prev) => [...prev, msg]);
    if (msg.role === 'user') {
      setTimeout(() => {
        const result = generateAIResponse(msg.text, {
          needToHave: needRef.current,
          niceToHave: niceRef.current,
          optional: optionalRef.current,
          sectionOverrides: overridesRef.current,
        });

        if (result.sectionOverride) {
          setSectionOverrides((prev) => ({
            ...prev,
            [result.sectionOverride!.courseId]: result.sectionOverride!.sectionId,
          }));
        }

        setChatMessages((prev) => [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            text: result.text,
            actions: result.actions,
          },
        ]);
      }, 800);
    }
  };

  return (
    <AppContext.Provider
      value={{
        screen,
        setScreen,
        addedCourses,
        addCourse,
        removeCourse,
        needToHave,
        niceToHave,
        optional,
        setNeedToHave,
        setNiceToHave,
        setOptional,
        sacrificedFrom,
        setSacrificedFrom,
        isChatOpen,
        toggleChat,
        chatMessages,
        addChatMessage,
        markActionsHandled,
        sectionOverrides,
        setSectionOverride,
        removeSectionOverride,
        browseAddedIds,
        addBrowseAddedId,
        removeBrowseAddedId,
        clearBrowseAddedIds,
        student: STUDENT,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
