import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT?.trim();
const agentName = process.env.FOUNDRY_AGENT_NAME?.trim();
const model = process.env.FOUNDRY_MODEL_DEPLOYMENT?.trim();
const vectorStoreName = "age-recovery-faq";
const faqFileName = "faq-age-recovery.md";

async function main() {
  if (!projectEndpoint || !agentName || !model) {
    console.error(
      "Configura FOUNDRY_PROJECT_ENDPOINT, FOUNDRY_AGENT_NAME y FOUNDRY_MODEL_DEPLOYMENT.",
    );
    process.exitCode = 1;
    return;
  }

  const faqPath = path.join(import.meta.dirname, "..", "agent", faqFileName);
  const instructionsPath = path.join(
    import.meta.dirname,
    "..",
    "agent",
    "instrucciones.md",
  );

  let instructions;
  try {
    instructions = (await readFile(instructionsPath, "utf8")).trim();
  } catch {
    console.error("No se pudo leer el archivo agent/instrucciones.md.");
    process.exitCode = 1;
    return;
  }

  if (!instructions) {
    console.error("El archivo agent/instrucciones.md está vacío.");
    process.exitCode = 1;
    return;
  }

  try {
    const projectClient = new AIProjectClient(
      projectEndpoint,
      new DefaultAzureCredential(),
    );
    const openAIClient = projectClient.getOpenAIClient();

    await projectClient.agents.get(agentName);

    let vectorStore;
    for await (const candidate of openAIClient.vectorStores.list()) {
      if (candidate.name === vectorStoreName) {
        vectorStore = candidate;
        break;
      }
    }

    if (!vectorStore) {
      vectorStore = await openAIClient.vectorStores.create({
        name: vectorStoreName,
      });
    }

    let faqVectorFile;
    for await (const candidate of openAIClient.vectorStores.files.list(
      vectorStore.id,
    )) {
      const file = await openAIClient.files.retrieve(candidate.id);
      if (file.filename === faqFileName) {
        faqVectorFile = candidate;
        break;
      }
    }

    if (faqVectorFile?.status === "in_progress") {
      faqVectorFile = await openAIClient.vectorStores.files.poll(
        vectorStore.id,
        faqVectorFile.id,
      );
    } else if (!faqVectorFile) {
      faqVectorFile = await openAIClient.vectorStores.files.uploadAndPoll(
        vectorStore.id,
        createReadStream(faqPath),
      );
    }

    if (faqVectorFile.status !== "completed" || faqVectorFile.last_error) {
      throw new Error("FAQ processing failed.");
    }

    const agent = await projectClient.agents.createVersion(agentName, {
      kind: "prompt",
      model,
      instructions,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [vectorStore.id],
        },
      ],
    });

    console.log(
      `Conocimiento agregado al agente "${agent.name}" en la versión ${agent.version}.`,
    );
  } catch {
    console.error(
      "No se pudo agregar el conocimiento. Revisa las credenciales, el acceso al proyecto y los archivos de agent/.",
    );
    process.exitCode = 1;
  }
}

await main();
