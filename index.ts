import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { config, higgsfield } from "@higgsfield/client/v2";

async function main(): Promise<void> {
  // Only this server-side process loads the secret. Never log env or SDK errors.
  loadEnv({ path: fileURLToPath(new URL(".env.local", import.meta.url)), quiet: true });
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials || credentials === "your-key-id:your-key-secret" ||
      !/^[^\s:]+:[^\s:]+$/.test(credentials)) {
    console.error("Set HF_CREDENTIALS locally in .env.local using key-id:key-secret format.");
    process.exitCode = 1;
    return;
  }

  config({ credentials, maxRetries: 0, maxPollTime: 30 * 60 * 1000 });
  console.error("Submitting one billable Seedance generation and waiting for completion...");
  const result = await higgsfield.subscribe("bytedance/seedance-2.5/text-to-video", {
    input: {
      prompt: "A cinematic scene at sunset",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "16:9",
    },
    withPolling: true,
  });

  // Use a string to also reject terminal statuses added by the API before SDK types.
  const status: string = result.status;
  if (status !== "completed") {
    const messages: Record<string, string> = {
      failed: "Generation failed.",
      canceled: "Generation was canceled.",
      cancelled: "Generation was canceled.",
      nsfw: "Generation was rejected by moderation.",
      moderated: "Generation was rejected by moderation.",
    };
    console.error(messages[status] ?? "Generation did not complete successfully.");
    process.exitCode = 1;
    return;
  }

  const url = result.video?.url;
  if (!url || !["https:", "http:"].includes(new URL(url).protocol)) {
    console.error("Completed response did not contain a valid video URL.");
    process.exitCode = 1;
    return;
  }
  console.log(url);
}

main().catch(() => {
  // SDK error objects may contain request headers, so never print them.
  console.error("Generation could not be verified (API, network, authentication, or polling error). Check the Higgsfield console before retrying; a request may already be billable.");
  process.exitCode = 1;
});
