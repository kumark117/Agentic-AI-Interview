import { Question } from "../lib/types";

export function QuestionPanel({
  question,
  currentQuestionNumber,
  maxQuestions
}: {
  question: Question | null;
  currentQuestionNumber: number;
  maxQuestions: number | null;
}) {
  const progressLabel =
    maxQuestions != null && maxQuestions > 0
      ? `Current question: ${currentQuestionNumber} / ${maxQuestions}`
      : null;

  return (
    <section>
      <div className="question-panel__head">
        <h2>Question</h2>
        {progressLabel ? <span className="question-panel__progress">{progressLabel}</span> : null}
      </div>
      {question ? (
        <>
          <p>{question.text}</p>
          <p>Difficulty: {question.difficulty}</p>
        </>
      ) : (
        <p>No active question.</p>
      )}
    </section>
  );
}
