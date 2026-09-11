export type StatementValidationInput = {
  opening?: number;
  ending?: number;
  receipts: number;
  spending: number;
  tolerance?: number;
};

export type StatementValidation = {
  status: "matched" | "incomplete" | "mismatch";
  expectedEnding?: number;
  difference?: number;
  warnings: string[];
};

/** Deterministically checks the cash roll-forward before financial state is trusted. */
export function validateStatementRollforward(input: StatementValidationInput): StatementValidation {
  const tolerance = input.tolerance ?? 0.01;
  const warnings: string[] = [];
  if (input.opening === undefined) warnings.push("Opening balance is missing.");
  if (input.ending === undefined) warnings.push("Ending balance is missing.");
  if (input.opening === undefined || input.ending === undefined) return { status: "incomplete", warnings };
  const expectedEnding = input.opening + input.receipts - input.spending;
  const difference = input.ending - expectedEnding;
  if (Math.abs(difference) > tolerance) {
    warnings.push(`Statement ending differs from calculated ending by ${Math.abs(difference).toFixed(2)}.`);
    return { status: "mismatch", expectedEnding, difference, warnings };
  }
  return { status: "matched", expectedEnding, difference, warnings };
}
