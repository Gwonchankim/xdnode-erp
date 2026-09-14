import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../../erp-platform";
import { getAccountTimeline, getDataQualityAlerts, searchAccountNames } from "../../../../sales-sheet-insights";
import { convertLeadToOpportunity, ensureLeadConversionSchema } from "../../../../sales-sheet-lead-conversion";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

export async function GET(request: Request) {
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "alerts";

  if (type === "accounts") {
    const names = await searchAccountNames(db, url.searchParams.get("q") ?? "");
    return Response.json({ names });
  }
  if (type === "timeline") {
    const name = url.searchParams.get("name") ?? "";
    if (!name.trim()) return Response.json({ error: "거래처명을 입력해 주세요." }, { status: 400 });
    const events = await getAccountTimeline(db, name);
    return Response.json({ name: name.trim(), events });
  }
  const alerts = await getDataQualityAlerts(db);
  return Response.json(alerts);
}

export async function POST(request: Request) {
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  await ensureLeadConversionSchema(db);

  const body = await request.json() as { action?: string; leadId?: string };
  if (body.action !== "CONVERT_LEAD" || !body.leadId) return Response.json({ error: "알 수 없는 요청입니다." }, { status: 400 });

  try {
    const result = await convertLeadToOpportunity(db, body.leadId, authorization.principal);
    if (!result.alreadyConverted) {
      await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SHEET_LEAD_CONVERTED", entityType: "SALES_OPPORTUNITY", entityId: result.opportunityId, after: result });
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "리드를 영업기회로 전환하지 못했습니다." }, { status: 400 });
  }
}
