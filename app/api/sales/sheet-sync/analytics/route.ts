import { env } from "cloudflare:workers";
import { authorizeErpRequest } from "../../../../erp-platform";
import {
  getCollectionSummary, getCollectionTrend, getCustomerConcentration, getEngagementAnomaly, getInboundLeadFunnel,
  getItemPerformance, getLeadProtectionFunnel, getMarginDistribution, getMonthlyTrend, getPipelineConfidence,
  getPipelineCoverage, getRepPerformance, getUnmatchedWinLeadProtections, getWhitespace,
} from "../../../../sales-sheet-analytics";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

export async function GET() {
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;

  const [
    monthlyTrend, repPerformance, customerConcentration, marginDistribution,
    itemPerformance, collectionTrend, collectionSummary, inboundLeadFunnel, leadProtectionFunnel, unmatchedWinLeadProtections,
    pipelineConfidence, pipelineCoverage, whitespace, engagementAnomaly,
  ] = await Promise.all([
    getMonthlyTrend(db),
    getRepPerformance(db),
    getCustomerConcentration(db),
    getMarginDistribution(db),
    getItemPerformance(db),
    getCollectionTrend(db),
    getCollectionSummary(db),
    getInboundLeadFunnel(db),
    getLeadProtectionFunnel(db),
    getUnmatchedWinLeadProtections(db),
    getPipelineConfidence(db),
    getPipelineCoverage(db),
    getWhitespace(db),
    getEngagementAnomaly(db),
  ]);

  return Response.json({
    monthlyTrend, repPerformance, customerConcentration, marginDistribution,
    itemPerformance, collectionTrend, collectionSummary, inboundLeadFunnel, leadProtectionFunnel, unmatchedWinLeadProtections,
    pipelineConfidence, pipelineCoverage, whitespace, engagementAnomaly,
  });
}
