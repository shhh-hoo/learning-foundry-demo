export type VariableReference =
  | { readonly source: "AUTHORED_FACT"; readonly factId: string; readonly symbol: string }
  | { readonly source: "REASONING_QUANTITY"; readonly reasoningNodeId: string; readonly symbol: string };

export type ExpressionAst =
  | { readonly kind: "NUMBER"; readonly value: number; readonly raw: string }
  | { readonly kind: "VARIABLE"; readonly reference: VariableReference }
  | {
      readonly kind: "BINARY";
      readonly operator: "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE" | "POWER";
      readonly left: ExpressionAst;
      readonly right: ExpressionAst;
    }
  | { readonly kind: "FUNCTION"; readonly name: "SUM"; readonly arguments: readonly ExpressionAst[] };

export const numberExpression = (value: number): ExpressionAst => ({
  kind: "NUMBER",
  value,
  raw: String(value),
});

export const factVariable = (factId: string, symbol: string): ExpressionAst => ({
  kind: "VARIABLE",
  reference: { source: "AUTHORED_FACT", factId, symbol },
});

export const quantityVariable = (reasoningNodeId: string, symbol: string): ExpressionAst => ({
  kind: "VARIABLE",
  reference: { source: "REASONING_QUANTITY", reasoningNodeId, symbol },
});

export const binaryExpression = (
  operator: Extract<ExpressionAst, { kind: "BINARY" }>["operator"],
  left: ExpressionAst,
  right: ExpressionAst,
): ExpressionAst => ({ kind: "BINARY", operator, left, right });

