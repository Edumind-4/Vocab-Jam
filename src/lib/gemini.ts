import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export interface QuizQuestion {
  word: string;
  questionText: string;
  definition: string;
  options: string[];
  correctIndex: number;
}

export interface QuizParams {
  topic: string;
  grade?: string;
  subject?: string;
  quantity?: number;
}

export async function generateQuiz(params: QuizParams): Promise<QuizQuestion[]> {
  const { topic, grade = "High School", subject = "General", quantity = 10 } = params;
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a professional-grade vocabulary and concept quiz for ${grade} level ${subject} students focusing on "${topic}".
      
      Requirements:
      1. Create exactly ${quantity} questions.
      2. Each question must include:
         - word: The target term.
         - questionText: A specific question about the word (e.g., "What does this mean?", "Where would you typically find this?", "Which is a synonym?").
         - definition: The correct answer/explanation.
         - options: 4 choice strings.
         - correctIndex: 0-3.
      3. CRITICAL: Distractors must be highly plausible and challenging.
      4. CRITICAL: Distractors must match the category/intent of the questionText.
      5. Ensure questions are diverse and avoid repetitive phrasing.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              questionText: { type: Type.STRING },
              definition: { type: Type.STRING },
              options: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              },
              correctIndex: { 
                type: Type.NUMBER
              }
            },
            required: ["word", "questionText", "definition", "options", "correctIndex"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from AI");
    }
    
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(error.message || "Failed to generate quiz. Please try again.");
  }
}
