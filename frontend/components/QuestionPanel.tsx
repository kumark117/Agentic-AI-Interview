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
  const title =
    maxQuestions != null && maxQuestions > 0
      ? `Question ${currentQuestionNumber} / ${maxQuestions}`
      : "Question";

  return (
    <section className="question-panel">
      <h2 className="question-panel__title">{title}</h2>
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
