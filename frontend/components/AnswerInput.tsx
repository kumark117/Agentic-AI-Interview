import { FormEvent, useEffect, useRef, useState } from "react";

export function AnswerInput({
  disabled,
  onSubmit,
  questionKey
}: {
  disabled: boolean;
  onSubmit: (answerText: string) => Promise<void>;
  /** When this changes (new question), the draft answer is cleared. Not cleared on submit, so the last answer stays visible until the next question or unmount. */
  questionKey: string | null;
}) {
  const [answer, setAnswer] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const previousQuestionKey = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const key = questionKey ?? null;
    if (previousQuestionKey.current !== undefined && previousQuestionKey.current !== key) {
      setAnswer("");
      setValidationError(null);
    }
    previousQuestionKey.current = key;
  }, [questionKey]);

  function validateAnswer(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) return "Answer cannot be empty.";

    const lettersOnly = trimmed.replace(/[^A-Za-z]/g, "").toLowerCase();
    if (lettersOnly.length >= 8 && new Set(lettersOnly).size <= 2) {
      return "Answer looks invalid. Please provide a meaningful response.";
    }

    if (trimmed.length < 12) {
      return "Answer is too short. Please add a bit more detail.";
    }

    return null;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const error = validateAnswer(answer);
    setValidationError(error);
    if (error) {
      return;
    }
    await onSubmit(answer);
    setValidationError(null);
  }

  return (
    <section className="qa-input-section">
      <h3>Your Answer</h3>
      <form onSubmit={handleSubmit} className="qa-input-form">
        <textarea
          rows={6}
          placeholder="Type your answer..."
          value={answer}
          onChange={(e) => {
            const nextValue = e.target.value;
            setAnswer(nextValue);
            if (validationError) {
              setValidationError(validateAnswer(nextValue));
            }
          }}
          disabled={disabled}
        />
        {validationError ? <p style={{ color: "#ff8a8a", marginTop: -6 }}>{validationError}</p> : null}
        <button type="submit" disabled={disabled || !answer.trim()}>
          Submit Answer
        </button>
      </form>
    </section>
  );
}
