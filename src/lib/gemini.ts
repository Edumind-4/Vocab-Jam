import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export interface QuizQuestion {
  word: string;
  definition: string;
  options: string[];
  correctIndex: number;
}

export async function generateQuiz(criteria: string): Promise<QuizQuestion[]> {
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: `Generate a vocabulary quiz based on the following criteria: "${criteria}". 
    Create exactly 10 questions. Each question must have a target word, its definition, and 4 multiple-choice options (one correct, three plausible distractors).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            definition: { type: Type.STRING },
            options: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "Must contain 4 items"
            },
            correctIndex: { 
              type: Type.NUMBER,
              description: "Zero-based index of the correct answer in the options array"
            }
          },
          required: ["word", "definition", "options", "correctIndex"]
        }
      }
    }
  });

  try {
    const questions = JSON.parse(result.text);
    return questions;
  } catch (e) {
    console.error("Failed to parse AI response", e);
    throw new Error("Failed to generate quiz. Please try again.");
  }
}
