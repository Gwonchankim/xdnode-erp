type SheetsBindings = {
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  GOOGLE_SALES_SHEET_ID?: string;
};

export function googleSheetsConfigured(env: SheetsBindings) {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN && env.GOOGLE_SALES_SHEET_ID);
}

async function getAccessToken(env: SheetsBindings) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(`구글 인증 토큰 발급 실패: ${data.error_description || data.error || response.status}`);
  return data.access_token;
}

export type SheetCell = string | number | boolean | null;

// Fetches multiple sheet ranges (e.g. "'26년 매출'!1:4000") in one call via values:batchGet.
export async function fetchSheetRanges(env: SheetsBindings, ranges: string[]) {
  const accessToken = await getAccessToken(env);
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SALES_SHEET_ID}/values:batchGet?${query}&valueRenderOption=UNFORMATTED_VALUE`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json() as { valueRanges?: Array<{ range: string; values?: SheetCell[][] }>; error?: { message?: string } };
  if (!response.ok) throw new Error(`구글 시트 조회 실패: ${data.error?.message || response.status}`);
  return (data.valueRanges ?? []).map((entry) => entry.values ?? []);
}
