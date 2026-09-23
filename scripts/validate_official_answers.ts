declare const require: {
  (moduleName: string): any;
  main?: any;
};
declare const process: {
  cwd: () => string;
  exit: (code?: number) => void;
  env: Record<string, string | undefined>;
};
declare const module: {
  exports: any;
};

const fs = require('fs');
const path = require('path');

export interface ValidationSummary {
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  errors: { file: string; message: string }[];
  cases: string[];
}

export function validateOfficialAnswers(): ValidationSummary {
  const casesDir = path.resolve(process.cwd(), 'cases');
  const summary: ValidationSummary = {
    totalFiles: 0,
    validFiles: 0,
    invalidFiles: 0,
    errors: [],
    cases: []
  };

  if (!fs.existsSync(casesDir)) {
    summary.errors.push({ file: 'cases', message: 'Directory "cases" does not exist' });
    return summary;
  }

  const files = fs.readdirSync(casesDir).filter((f: string) => f.endsWith('.json')).sort();
  summary.totalFiles = files.length;

  const validVerdicts = ['fraud', 'legitimate', 'uncertain'];
  const validPatterns = [
    'card_testing',
    'card_not_present_fraud',
    'card_not_present_new_device',
    'out_of_region_use',
    'account_takeover',
    'undocumented',
    'none'
  ];
  const validRoutes = ['auto', 'L1', 'L2'];
  const validActionNames = [
    'ALLOW_TRANSACTION',
    'DECLINE_TRANSACTION',
    'MONITOR_CARD',
    'MONITOR_CONNECTED_CARDS',
    'WARN_CUSTOMER',
    'VERIFY_WITH_CUSTOMER',
    'STEP_UP_AUTH',
    'BLOCK_CARD',
    'BLOCK_ALL_CARDS',
    'GENERATE_REPORT',
    'CREATE_CASE',
    'FILE_REPORT',
    'ESCALATE_TO_ANALYST',
    'CLOSE_NO_FRAUD',
  ];

  for (const file of files) {
    const filePath = path.join(casesDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // 1. Check for secret tokens accidentally leaked
      const sensitiveKeywords = ['gsql_secret', 'tigergraph_secret', 'bearer gsk_', 'supabase_service', 'eyjhbgcioij'];
      for (const kw of sensitiveKeywords) {
        if (content.toLowerCase().includes(kw)) {
          summary.errors.push({ file, message: `Contains sensitive credential keyword: "${kw}"` });
        }
      }

      const parsed = JSON.parse(content);

      // Top-level fields:
      // case_id, case, evidence_requests, next_best_actions, sar, stop_reason, tool_calls, tokens, latency_s
      if (!parsed.case_id || typeof parsed.case_id !== 'string') {
        summary.errors.push({ file, message: 'Missing or invalid top-level "case_id"' });
      } else {
        summary.cases.push(parsed.case_id);
      }

      if (!parsed.case || typeof parsed.case !== 'object') {
        summary.errors.push({ file, message: 'Missing or invalid top-level "case"' });
      }

      if (!Array.isArray(parsed.evidence_requests)) {
        summary.errors.push({ file, message: 'Missing or invalid top-level "evidence_requests" array' });
      }

      if (!parsed.next_best_actions || typeof parsed.next_best_actions !== 'object') {
        summary.errors.push({ file, message: 'Missing or invalid top-level "next_best_actions"' });
      }

      if (!parsed.sar || typeof parsed.sar !== 'object') {
        summary.errors.push({ file, message: 'Missing or invalid top-level "sar"' });
      }

      if (typeof parsed.stop_reason !== 'string' || parsed.stop_reason.trim().length === 0) {
        summary.errors.push({ file, message: 'Missing or empty top-level "stop_reason"' });
      }

      if (typeof parsed.tool_calls !== 'number' || parsed.tool_calls < 0) {
        summary.errors.push({ file, message: 'Invalid or negative "tool_calls"' });
      }

      if (typeof parsed.tokens !== 'number' || parsed.tokens < 0) {
        summary.errors.push({ file, message: 'Invalid or negative "tokens"' });
      }

      if (typeof parsed.latency_s !== 'number' || parsed.latency_s < 0) {
        summary.errors.push({ file, message: 'Invalid or negative "latency_s"' });
      }

      // Validate "case"
      const c = parsed.case;
      if (c) {
        if (!['open', 'closed_fraud', 'closed_legitimate', 'escalated'].includes(c.status)) {
          summary.errors.push({ file, message: `Invalid case.status: ${c.status}` });
        }
        if (!validVerdicts.includes(c.verdict)) {
          summary.errors.push({ file, message: `Invalid case.verdict: ${c.verdict}` });
        }
        if (typeof c.fraud_probability !== 'number' || c.fraud_probability < 0 || c.fraud_probability > 1) {
          summary.errors.push({ file, message: `case.fraud_probability out of bounds [0, 1]: ${c.fraud_probability}` });
        }
        if (!validPatterns.includes(c.pattern)) {
          summary.errors.push({ file, message: `Invalid case.pattern: ${c.pattern}` });
        }
        if (c.pattern === 'undocumented' && (!c.pattern_description || c.pattern_description.trim().length === 0)) {
          summary.errors.push({ file, message: 'case.pattern is "undocumented" but pattern_description is empty' });
        }
        if (!Array.isArray(c.affected_txn_ids)) {
          summary.errors.push({ file, message: 'case.affected_txn_ids must be an array' });
        }
        if (c.verdict === 'legitimate' && c.affected_txn_ids.length > 0) {
          summary.errors.push({ file, message: 'case.verdict is "legitimate" but affected_txn_ids is not empty' });
        }
        if (typeof c.first_suspicious_txn_id !== 'string') {
          summary.errors.push({ file, message: 'case.first_suspicious_txn_id must be a string' });
        }
        if (!Array.isArray(c.connected_card_ids)) {
          summary.errors.push({ file, message: 'case.connected_card_ids must be an array' });
        }
        if (!Array.isArray(c.connected_device_profiles)) {
          summary.errors.push({ file, message: 'case.connected_device_profiles must be an array' });
        }
        if (typeof c.exposure_usd !== 'number' || c.exposure_usd < 0) {
          summary.errors.push({ file, message: `Invalid case.exposure_usd: ${c.exposure_usd}` });
        }
        if (c.verdict === 'legitimate' && c.exposure_usd !== 0) {
          summary.errors.push({ file, message: `case.verdict is "legitimate" but exposure_usd is ${c.exposure_usd}` });
        }
        if (!Array.isArray(c.evidence)) {
          summary.errors.push({ file, message: 'case.evidence must be an array' });
        } else {
          for (const ev of c.evidence) {
            if (!ev.claim || typeof ev.claim !== 'string') summary.errors.push({ file, message: 'Evidence item missing claim' });
            if (!['graph', 'document', 'customer', 'external'].includes(ev.source)) {
              summary.errors.push({ file, message: `Invalid evidence source: ${ev.source}` });
            }
            if (!ev.ref || typeof ev.ref !== 'string') summary.errors.push({ file, message: 'Evidence item missing ref' });
            if (!Array.isArray(ev.entity_ids)) summary.errors.push({ file, message: 'Evidence item entity_ids must be array' });
          }
        }
        if (!Array.isArray(c.similar_prior_cases)) {
          summary.errors.push({ file, message: 'case.similar_prior_cases must be an array' });
        }
        if (typeof c.summary !== 'string' || c.summary.trim().length === 0) {
          summary.errors.push({ file, message: 'case.summary must be a non-empty string' });
        }
        if (typeof c.written_to_graph !== 'boolean') {
          summary.errors.push({ file, message: 'case.written_to_graph must be a boolean' });
        }
        if (typeof c.graph_case_id !== 'string') {
          summary.errors.push({ file, message: 'case.graph_case_id must be a string' });
        }
      }

      // Validate "sar"
      const sar = parsed.sar;
      if (sar) {
        if (typeof sar.file !== 'boolean') {
          summary.errors.push({ file, message: 'sar.file must be boolean' });
        }
        if (typeof sar.reason !== 'string' || sar.reason.trim().length === 0) {
          summary.errors.push({ file, message: 'sar.reason must be a non-empty string' });
        }
        if (typeof sar.total_amount_usd !== 'number') {
          summary.errors.push({ file, message: 'sar.total_amount_usd must be number' });
        }
        if (!Array.isArray(sar.subjects)) {
          summary.errors.push({ file, message: 'sar.subjects must be an array' });
        }
        if (!Array.isArray(sar.activity_dates)) {
          summary.errors.push({ file, message: 'sar.activity_dates must be an array' });
        }
        // Strict specification: if sar.file is false, narrative must be empty, total_amount_usd 0
        if (!sar.file) {
          if (sar.total_amount_usd !== 0) {
            summary.errors.push({ file, message: `sar.file is false but total_amount_usd is ${sar.total_amount_usd}` });
          }
          if (sar.narrative && sar.narrative.length > 0) {
            summary.errors.push({ file, message: 'sar.file is false but narrative is not empty' });
          }
          if (sar.subjects.length > 0) {
            summary.errors.push({ file, message: 'sar.file is false but subjects is not empty' });
          }
          if (sar.activity_dates.length > 0) {
            summary.errors.push({ file, message: 'sar.file is false but activity_dates is not empty' });
          }
        } else {
          if (!sar.narrative || sar.narrative.trim().length === 0) {
            summary.errors.push({ file, message: 'sar.file is true but narrative is empty' });
          }
        }
      }

      // Validate "next_best_actions"
      const nba = parsed.next_best_actions;
      if (nba) {
        if (!Array.isArray(nba.initial) || nba.initial.length === 0) {
          summary.errors.push({ file, message: 'Missing or empty next_best_actions.initial array' });
        } else {
          for (const act of nba.initial) {
            if (!act.action) {
              summary.errors.push({ file, message: 'next_best_actions.initial item missing action' });
            } else if (!validActionNames.includes(act.action)) {
              summary.errors.push({ file, message: `Invalid action name in initial: "${act.action}" (must match official 14 actions)` });
            }
            if (!validRoutes.includes(act.route)) summary.errors.push({ file, message: `Invalid route in initial action: ${act.route}` });
            if (!act.reason) summary.errors.push({ file, message: 'next_best_actions.initial item missing reason' });
          }
        }

        if (!Array.isArray(nba.final) || nba.final.length === 0) {
          summary.errors.push({ file, message: 'Missing or empty next_best_actions.final array' });
        } else {
          for (const act of nba.final) {
            if (!act.action) {
              summary.errors.push({ file, message: 'next_best_actions.final item missing action' });
            } else if (!validActionNames.includes(act.action)) {
              summary.errors.push({ file, message: `Invalid action name in final: "${act.action}" (must match official 14 actions)` });
            }
            if (!validRoutes.includes(act.route)) summary.errors.push({ file, message: `Invalid route in final action: ${act.route}` });
            if (!act.reason) summary.errors.push({ file, message: 'next_best_actions.final item missing reason' });
          }
        }

        if (typeof nba.what_changed !== 'string' || nba.what_changed.trim().length === 0) {
          summary.errors.push({ file, message: 'Missing or empty next_best_actions.what_changed' });
        }

        // Consistency check: FILE_REPORT in final actions must agree with sar.file
        const fileReportInFinal = nba.final.some((a: any) => a.action === 'FILE_REPORT');
        if (sar && sar.file !== fileReportInFinal) {
          summary.errors.push({ file, message: `sar.file (${sar.file}) does not match whether FILE_REPORT is in final actions (${fileReportInFinal})` });
        }

        // Regression check: what_changed narrative must not contradict final NBA actions
        const finalHasAllow = nba.final.some((a: any) => a.action === 'ALLOW_TRANSACTION');
        const finalHasBlock = nba.final.some((a: any) => a.action === 'BLOCK_CARD');
        const whatChangedLower = nba.what_changed.toLowerCase();
        if (finalHasAllow && (whatChangedLower.includes('card block') || whatChangedLower.includes('block the card'))) {
          summary.errors.push({ file, message: `what_changed claims card block but final actions include ALLOW_TRANSACTION` });
        }
        if (finalHasBlock && (whatChangedLower.includes('allow transaction') || whatChangedLower.includes('cleared as legitimate'))) {
          summary.errors.push({ file, message: `what_changed claims transaction allowed but final actions include BLOCK_CARD` });
        }
      }

      const fileErrors = summary.errors.filter(e => e.file === file);
      if (fileErrors.length === 0) {
        summary.validFiles++;
      } else {
        summary.invalidFiles++;
      }

    } catch (err: any) {
      summary.invalidFiles++;
      summary.errors.push({ file, message: `Parse error: ${err.message}` });
    }
  }

  return summary;
}

if (typeof require !== 'undefined' && require.main === (typeof module !== 'undefined' ? module : null)) {
  const result = validateOfficialAnswers();
  console.log('\n========================================');
  console.log('OFFICIAL ANSWERS VALIDATION REPORT');
  console.log('========================================');
  console.log(`Total Files Found: ${result.totalFiles}/20`);
  console.log(`Valid Files:       ${result.validFiles}`);
  console.log(`Invalid Files:     ${result.invalidFiles}`);

  if (result.errors.length > 0) {
    console.error('\nERRORS FOUND:');
    result.errors.forEach(err => console.error(`  - [${err.file}]: ${err.message}`));
    process.exit(1);
  } else {
    console.log('\nAll 20/20 files strictly comply with the official Hacker House Goa schema.');
    process.exit(0);
  }
}
