import { formatEvaluationSource } from "../lib/formatDisplay";
import { EvaluationPayload } from "../lib/types";

export function FeedbackPanel({ feedback }: { feedback: EvaluationPayload | null }) {
  return (
    <section className="feedback-panel">
      <h3>Latest Feedback</h3>
      {!feedback ? (
        <p>No feedback yet.</p>
      ) : (
        <>
          <p>Score: {feedback.score}</p>
          <p>Confidence: {feedback.confidence}</p>
          <p>Source: {formatEvaluationSource(feedback.source)}</p>
          <p>{feedback.feedback}</p>
        </>
      )}
    </section>
  );
}
