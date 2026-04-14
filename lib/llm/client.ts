import { GoogleGenAI } from "@google/genai";

const globalForLlm = globalThis as unknown as { __ccGenAI?: GoogleGenAI };

export function getGenAI(): GoogleGenAI {
  if (!globalForLlm.__ccGenAI) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is not set. Add it to .env.local (https://aistudio.google.com/apikey).",
      );
    }
    globalForLlm.__ccGenAI = new GoogleGenAI({ apiKey: key });
  }
  return globalForLlm.__ccGenAI;
}
