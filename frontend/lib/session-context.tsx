"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { Question } from "./types";

type SessionStore = {
  sessionId: string | null;
  token: string | null;
  currentQuestion: Question | null;
  candidateId: string | null;
  candidateName: string | null;
  maxQuestions: number | null;
  questionsAsked: number;
  interviewMode: "llm" | "mock" | null;
  setSession: (
    sessionId: string,
    token: string,
    question: Question,
    candidateId: string,
    candidateName: string,
    maxQuestions: number,
    interviewMode?: "llm" | "mock"
  ) => void;
  incrementQuestionsAsked: () => void;
  setCurrentQuestion: (question: Question | null) => void;
  clearSession: () => void;
};

const SessionContext = createContext<SessionStore | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState<string | null>(null);
  const [maxQuestions, setMaxQuestions] = useState<number | null>(null);
  const [questionsAsked, setQuestionsAsked] = useState(0);
  const [interviewMode, setInterviewMode] = useState<"llm" | "mock" | null>(null);

  const value = useMemo<SessionStore>(
    () => ({
      sessionId,
      token,
      currentQuestion,
      candidateId,
      candidateName,
      maxQuestions,
      questionsAsked,
      interviewMode,
      setSession: (nextSessionId, nextToken, question, nextCandidateId, nextCandidateName, nextMaxQuestions, nextInterviewMode) => {
        setSessionId(nextSessionId);
        setToken(nextToken);
        setCurrentQuestion(question);
        setCandidateId(nextCandidateId);
        setCandidateName(nextCandidateName);
        setMaxQuestions(nextMaxQuestions);
        setQuestionsAsked(1);
        setInterviewMode(nextInterviewMode ?? null);
      },
      incrementQuestionsAsked: () => setQuestionsAsked((prev) => prev + 1),
      setCurrentQuestion,
      clearSession: () => {
        setSessionId(null);
        setToken(null);
        setCurrentQuestion(null);
        setCandidateId(null);
        setCandidateName(null);
        setMaxQuestions(null);
        setQuestionsAsked(0);
        setInterviewMode(null);
      }
    }),
    [sessionId, token, currentQuestion, candidateId, candidateName, maxQuestions, questionsAsked, interviewMode]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionStore() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionStore must be used within SessionProvider.");
  }
  return context;
}
