import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini API Initialization (Server-side)
  // Use lazy initialization as per guidelines
  let genAI: GoogleGenAI | null = null;
  function getGenAI() {
    if (!genAI) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is required");
      }
      genAI = new GoogleGenAI({ apiKey });
    }
    return genAI;
  }

  // API Routes
  app.post("/api/generate-quiz", async (req, res) => {
    try {
      const { criteria } = req.body;
      if (!criteria) {
        return res.status(400).json({ error: "Criteria is required" });
      }

      const ai = getGenAI();

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
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

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response from Gemini");
      }
      const questions = JSON.parse(responseText);
      res.json(questions);
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate quiz" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
