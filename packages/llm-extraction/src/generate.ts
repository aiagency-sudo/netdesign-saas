import { composeDesign } from "@netdesign/design-engine";
import type { Design } from "@netdesign/schema";
import { extractDesignParams, type ExtractDesignParamsOptions } from "./extract.js";

/**
 * The full pipeline for every pattern the engine supports: user prose ->
 * [LLM extraction] -> design-params -> [design-engine composer dispatch,
 * which validates against the schema] -> design JSON. The dispatcher
 * (composeDesign) routes to the right composer by designPattern, so new
 * patterns light up here with no change to this function or its callers.
 */
export async function generateDesign(prose: string, options: ExtractDesignParamsOptions): Promise<Design> {
  const params = await extractDesignParams(prose, options);
  return composeDesign(params);
}
