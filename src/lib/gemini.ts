export interface QuizQuestion {
  word: string;
  definition: string;
  options: string[];
  correctIndex: number;
}

export async function generateQuiz(criteria: string): Promise<QuizQuestion[]> {
  const response = await fetch("/api/generate-quiz", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ criteria }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to generate quiz");
  }

  return await response.json();
}
