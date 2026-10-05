export interface ModelPricing {
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
}

export const GEMINI_PRICING: Record<string, ModelPricing> = {
  "gemini-3.5-flash": {
    inputCostPerMillionTokens: 0.075,
    outputCostPerMillionTokens: 0.30
  },
  "gemini-3.8-flash": {
    inputCostPerMillionTokens: 0.075,
    outputCostPerMillionTokens: 0.30
  },
  "gemini-3-flash-preview": {
    inputCostPerMillionTokens: 0.075,
    outputCostPerMillionTokens: 0.30
  },
  "gemini-2.5-flash-preview-tts": {
    inputCostPerMillionTokens: 0.075,
    outputCostPerMillionTokens: 0.30
  },
  "gemini-2.5-flash-native-audio-preview-12-2025": {
    inputCostPerMillionTokens: 0.15,
    outputCostPerMillionTokens: 0.60
  },
  "default": {
    inputCostPerMillionTokens: 0.075,
    outputCostPerMillionTokens: 0.30
  }
};

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = GEMINI_PRICING[model] || GEMINI_PRICING["default"];
  const inputCost = (inputTokens / 1000000) * pricing.inputCostPerMillionTokens;
  const outputCost = (outputTokens / 1000000) * pricing.outputCostPerMillionTokens;
  return inputCost + outputCost;
}
