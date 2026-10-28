import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import OpenAI from "openai";
import { rateLimit } from "express-rate-limit";
import {
  TranslateGameTextBody,
  TranslateGameTextResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const translationRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Translation request rate limit reached. Try again shortly." },
});

const requireServiceToken: RequestHandler = (req, res, next) => {
  const expectedToken = process.env.KOTOBA_API_TOKEN;
  if (!expectedToken || Buffer.byteLength(expectedToken) < 32) {
    res.status(503).json({ error: "Translation service is not configured." });
    return;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") ?? "");
  const suppliedToken = match?.[1];
  if (!suppliedToken) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="kotoba-translation"');
    res.status(401).json({ error: "A valid service token is required." });
    return;
  }

  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="kotoba-translation"');
    res.status(401).json({ error: "A valid service token is required." });
    return;
  }

  next();
};

router.post("/translate", requireServiceToken, translationRateLimit, async (req, res): Promise<void> => {
  const parsed = TranslateGameTextBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter Japanese text to translate." });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "Translation is not configured. Add an OpenAI API key in project Secrets.",
    });
    return;
  }

  try {
    const openai = new OpenAI({ apiKey });
    const result = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "Translate Japanese video game dialogue into natural English. Return only the translation, with no explanation or quotation marks. Preserve names, intent, and line breaks. If the input is already English, return it unchanged.",
        },
        { role: "user", content: parsed.data.text },
      ],
    });

    const translatedText = result.choices[0]?.message.content?.trim();
    if (!translatedText) {
      res.status(502).json({ error: "The translation provider returned no text." });
      return;
    }

    res.json(
      TranslateGameTextResponse.parse({
        sourceText: parsed.data.text,
        translatedText,
      }),
    );
  } catch (error) {
    req.log.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Game text translation failed",
    );
    res.status(502).json({ error: "Translation is temporarily unavailable." });
  }
});

export default router;
