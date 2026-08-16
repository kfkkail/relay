import OpenAI from "openai";
import { runWithCodex } from "./codex-runner.mjs";

const OPENAI_INSTRUCTIONS =
  "Complete the task using only the supplied context. Return a concise, useful Markdown result. " +
  "You have no tools, filesystem, shell, browser, email, calendar, or GitHub access. " +
  "State any limitation instead of claiming an action you could not perform.";

export function createTaskRunner(env = process.env, dependencies = {}) {
  const backend = (env.RELAY_WORKER_BACKEND || "openai").toLowerCase();

  if (backend === "codex") {
    const runCodex = dependencies.runCodex || runWithCodex;
    return {
      backend,
      run(input) {
        return runCodex(input, {
          command: env.RELAY_CONTAINER_RUNTIME || "docker",
          image: env.RELAY_CODEX_IMAGE || undefined,
          authFile: env.RELAY_CODEX_AUTH_FILE,
          model: env.RELAY_CODEX_MODEL || undefined,
          timeoutMs: env.RELAY_CODEX_TIMEOUT_MS || undefined,
          workspace: env.RELAY_CODEX_WORKSPACE,
          env,
        });
      },
    };
  }

  if (backend === "openai") {
    const apiKey = required(env, "OPENAI_API_KEY");
    const model = env.OPENAI_MODEL || "gpt-5.6-sol";
    const Client = dependencies.OpenAI || OpenAI;
    const client = new Client({ apiKey });
    return {
      backend,
      async run(input) {
        const response = await client.responses.create({
          model,
          instructions: OPENAI_INSTRUCTIONS,
          input,
        });
        return response.output_text;
      },
    };
  }

  throw new Error("RELAY_WORKER_BACKEND must be either `codex` or `openai`.");
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required when RELAY_WORKER_BACKEND=openai.`);
  return value;
}
