import path from "node:path";
import express from "express";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

const app = express();
app.set("trust proxy", 1);
const port = Number(process.env.PORT) || 3000;
const agentName = process.env.FOUNDRY_AGENT_NAME;
const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
const configuredClinicContactUrl = process.env.CLINIC_CONTACT_URL?.trim();
let clinicContactUrl = null;
const publicDirectory = path.join(import.meta.dirname, "public");
const foundryConfigured = Boolean(agentName && projectEndpoint);
const rateLimitWindowMs = 60_000;
const rateLimitMaxRequests = 20;
const requestCounts = new Map();
let requestsSinceCleanup = 0;

if (configuredClinicContactUrl) {
  try {
    const parsedUrl = new URL(configuredClinicContactUrl);
    if (["http:", "https:"].includes(parsedUrl.protocol) && parsedUrl.hostname) {
      clinicContactUrl = parsedUrl;
    } else {
      throw new Error("Invalid contact URL protocol.");
    }
  } catch {
    console.warn("CLINIC_CONTACT_URL no es una URL HTTP/HTTPS válida; el botón de agenda permanecerá oculto.");
  }
}

let openAIClient;

function logFoundryFailure(error) {
  const message = "Foundry request failed.";
  const safeMessage = message
    .replaceAll(projectEndpoint ?? "", "[project endpoint]")
    .replaceAll(agentName ?? "", "[agent name]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token redacted]")
    .slice(0, 500);

  console.error("Foundry request failed", {
    statusCode: error?.statusCode ?? error?.status,
    code: error?.code,
  });
}

function isContentFilterError(error) {
  const statusCode = Number(error?.statusCode ?? error?.status);
  const codes = [
    error?.code,
    error?.error?.code,
    error?.error?.innererror?.code,
  ];

  return statusCode === 400
    && codes.some((code) => code === "content_filter" || code === "ResponsibleAIPolicyViolation");
}

function rateLimitByIp(request, response, next) {
  const now = Date.now();
  const ip = request.ip;
  const current = requestCounts.get(ip);

  if (!current || current.resetAt <= now) {
    requestCounts.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
  } else if (current.count >= rateLimitMaxRequests) {
    response.set("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
    response.status(429).json({
      error: "Has enviado varias solicitudes. Espera un momento e inténtalo de nuevo.",
    });
    return;
  } else {
    current.count += 1;
  }

  requestsSinceCleanup += 1;
  if (requestsSinceCleanup >= 100) {
    for (const [trackedIp, entry] of requestCounts) {
      if (entry.resetAt <= now) {
        requestCounts.delete(trackedIp);
      }
    }
    requestsSinceCleanup = 0;
  }

  next();
}

if (foundryConfigured) {
  const projectClient = new AIProjectClient(
    projectEndpoint,
    new DefaultAzureCredential(),
  );
  openAIClient = projectClient.getOpenAIClient();
}

app.use(express.json({ limit: "16kb" }));
app.use(express.static(publicDirectory));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/config", (_request, response) => {
  response.json({ clinicContactUrl: clinicContactUrl?.href ?? null });
});

app.post("/api/chat", rateLimitByIp, async (request, response) => {
  const message = typeof request.body?.message === "string"
    ? request.body.message.trim()
    : "";

  if (!message || message.length > 2000) {
    response.status(422).json({ error: "El mensaje debe tener entre 1 y 2000 caracteres." });
    return;
  }

  const suppliedConversationId = request.body?.conversation_id;
  if (suppliedConversationId != null && typeof suppliedConversationId !== "string") {
    response.status(422).json({ error: "El identificador de conversación no es válido." });
    return;
  }

  if (!openAIClient) {
    response.status(502).json({ error: "No fue posible procesar la solicitud de chat." });
    return;
  }

  let conversationId;
  try {
    conversationId = suppliedConversationId?.trim()
      || (await openAIClient.conversations.create()).id;
    const result = await openAIClient.responses.create(
      {
        conversation: conversationId,
        input: message,
      },
      {
        body: {
          agent_reference: { name: agentName, type: "agent_reference" },
        },
      },
    );

    response.json({
      reply: result.output_text,
      conversation_id: conversationId,
    });
  } catch (error) {
    logFoundryFailure(error);
    if (isContentFilterError(error)) {
      response.json({
        reply: "No puedo atender esa solicitud tal como está planteada. Puedo compartir información general sobre nuestros servicios y cuidados; para dudas clínicas, consulta al médico.",
        conversation_id: conversationId ?? null,
      });
      return;
    }

    response.status(502).json({ error: "No fue posible procesar la solicitud de chat." });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: "El cuerpo de la solicitud no contiene JSON válido." });
    return;
  }

  response.status(500).json({ error: "Ocurrió un error interno." });
});

app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}.`);
});