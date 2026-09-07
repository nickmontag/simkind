// Generated from schemas/0.2.0-draft.2/memory-retrieval.schema.json.
// Run npm run generate:format; do not edit by hand.

export interface MemoryRetrievalConfiguration {
  maxItems: number;
}

export const memoryRetrievalSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Memory retrieval configuration",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "maxItems": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1000
    }
  },
  "required": [
    "maxItems"
  ]
};
