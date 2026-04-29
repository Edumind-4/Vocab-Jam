import { GoogleGenAI, Type } from "@google/genai";

// Initialize with your Netlify Key
const genAI = new GoogleGenAI(import.meta.env.VITE_GEMINI_API_KEY);

export interface QuizQuestion {
  word: string;
  definition: string;
  options: string[];
  correctIndex: number;
}

export async function generateQuiz(criteria: string): Promise<QuizQuestion[]> {
  // Correct way to initialize the model
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  const prompt = `Generate a vocabulary quiz based on the following criteria: "${criteria}". 
  Create exactly 10 questions. Each question must have a target word, its definition, and 4 multiple-choice options (one correct, three plausible distractors).`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
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
              description: "Must contain exactly 4 items"
            },
            correctIndex: { 
              type: Type.NUMBER,
              description: "Zero-based index of the correct answer"
            }
          },
          required: ["word", "definition", "options", "correctIndex"]
        }
      }
    }
  });

  try {
    const responseText = result.response.text();
    return JSON.parse(responseText);
  } catch (error) {
    console.error("AI Error:", error);
    throw new Error("The AI gave an unexpected response. Please try again.");
  }
}
