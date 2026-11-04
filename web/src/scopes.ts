// Job 003u1: short, human names for evidence scopes, shared wherever a request or grant is listed.
// The full wording each grant was made under is the server's (meta.categories); these names don't
// change what any scope covers. An unknown key is shown as itself rather than guessed.

export const SCOPE_LABEL: Record<string, string> = {
  financials: "Financials",
  costs: "Costs",
  customers: "Customer activity",
  operations: "Operations and what transfers",
  digital_performance: "Digital performance",
};

export const scopeName = (key: string) => SCOPE_LABEL[key] ?? key;

export const scopeList = (keys: readonly string[]) => keys.map(scopeName).join(", ");
