import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export interface QuizQuestion {
  word: string;
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
      model: "gemini-2.5-flash-lite",
      contents: `Generate a professional-grade vocabulary quiz for ${grade} level ${subject} students focusing on "${topic}".
      
      Requirements:
      1. Create exactly ${quantity} questions.
      2. Each question must include a target word, its definition, 4 multiple-choice options, and the correct index.
      3. CRITICAL: Distractors must be highly plausible, challenging, and usually the same part of speech as the target word.
      4. CRITICAL: Never include the target word itself or its definition inside any of the distractor options.
      5. Ensure definitions are concise and accurate for the specified grade level.`,
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
                items: { type: Type.STRING }
              },
              correctIndex: { 
                type: Type.NUMBER
              }
            },
            required: ["word", "definition", "options", "correctIndex"]
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
