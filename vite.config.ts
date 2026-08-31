import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const fileEnv = command === "serve" ? loadEnv(mode, process.cwd(), "") : {};
  // LOCAL_ERP_USER_* 는 혼자 로컬에서 돌릴 때 쓰는 신원이다. Sign-in with ChatGPT 헤더가 없는
  // 환경에서만 app/chatgpt-auth.ts 가 이 값을 사용하고, 값이 없으면 예전처럼 로그인을 요구한다.
  const localRuntimeVars = Object.fromEntries(
    ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AI_MODEL",
      "LOCAL_ERP_USER_EMAIL", "LOCAL_ERP_USER_NAME",
      // 이력서 분석을 로컬 LLM 으로 돌릴 때 쓴다. 없으면 Workers AI 로 간다.
      "LOCAL_LLM_BASE_URL", "LOCAL_LLM_MODEL",
      // 영업 구글 시트 동기화용 OAuth 자격증명과 대상 스프레드시트 ID.
      "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN", "GOOGLE_SALES_SHEET_ID"]
      .map((key) => [key, fileEnv[key]] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    vars: localRuntimeVars,
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
  };

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
