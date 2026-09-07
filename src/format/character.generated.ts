// Generated from schemas/0.2.0-draft.1/character.schema.json.
// Run npm run generate:format; do not edit by hand.

/**
 * This interface was referenced by `CharacterDocument`'s JSON-Schema
 * via the `definition` "id".
 */
export type Id = string;
/**
 * This interface was referenced by `CharacterDocument`'s JSON-Schema
 * via the `definition` "profileId".
 */
export type ProfileId = string;

/**
 * Portable character definition. Validation does not establish execution compatibility.
 */
export interface CharacterDocument {
  specVersion: '0.2.0-draft.1';
  kind: 'character';
  id: Id;
  /**
   * Display name, never a reference key.
   */
  name: string;
  persona?: {
    /**
     * Character prose; the body in character Markdown.
     */
    description?: string;
    motivations?: string[];
    speakingStyle?: string;
  };
  startingState?: {
    intentions?: {
      id: Id;
      description: string;
    }[];
    /**
     * Private starting experiences. Temporal and historical-reference fields are reserved for a later revision.
     */
    memories?: {
      id: Id;
      text: string;
      source: {
        kind: 'authored' | 'observation' | 'report' | 'interpretation';
      };
    }[];
  };
  metadata?: {
    title?: string;
    description?: string;
    author?: string;
    license?: string;
    tags?: string[];
  };
  profiles?: {
    [k: string]: {
      version: string;
      required: boolean;
    };
  };
  /**
   * Opaque JSON keyed by declared profile ID; preservation grants no execution authority.
   */
  extensions?: {
    [k: string]: unknown;
  };
  /**
   * Descriptors only. The reader does not access resources.
   */
  resources?: {
    [k: string]: {
      /**
       * Bundle-relative POSIX path. Absolute paths, backslashes, URI syntax, and dot/empty segments are rejected.
       */
      path: string;
    };
  };
}

export const characterSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CharacterDocument",
  "description": "Portable character definition. Validation does not establish execution compatibility.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "specVersion",
    "kind",
    "id",
    "name"
  ],
  "properties": {
    "specVersion": {
      "const": "0.2.0-draft.1"
    },
    "kind": {
      "const": "character"
    },
    "id": {
      "$ref": "#/$defs/id"
    },
    "name": {
      "type": "string",
      "description": "Display name, never a reference key."
    },
    "persona": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "description": {
          "type": "string",
          "description": "Character prose; the body in character Markdown."
        },
        "motivations": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "speakingStyle": {
          "type": "string"
        }
      }
    },
    "startingState": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "intentions": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "id",
              "description"
            ],
            "properties": {
              "id": {
                "$ref": "#/$defs/id"
              },
              "description": {
                "type": "string"
              }
            }
          }
        },
        "memories": {
          "type": "array",
          "description": "Private starting experiences. Temporal and historical-reference fields are reserved for a later revision.",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "id",
              "text",
              "source"
            ],
            "properties": {
              "id": {
                "$ref": "#/$defs/id"
              },
              "text": {
                "type": "string"
              },
              "source": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "kind"
                ],
                "properties": {
                  "kind": {
                    "enum": [
                      "authored",
                      "observation",
                      "report",
                      "interpretation"
                    ]
                  }
                }
              }
            }
          }
        }
      }
    },
    "metadata": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "title": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "author": {
          "type": "string"
        },
        "license": {
          "type": "string"
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "profiles": {
      "type": "object",
      "propertyNames": {
        "$ref": "#/$defs/profileId"
      },
      "additionalProperties": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "version",
          "required"
        ],
        "properties": {
          "version": {
            "type": "string",
            "minLength": 1
          },
          "required": {
            "type": "boolean"
          }
        }
      }
    },
    "extensions": {
      "type": "object",
      "description": "Opaque JSON keyed by declared profile ID; preservation grants no execution authority.",
      "propertyNames": {
        "$ref": "#/$defs/profileId"
      },
      "additionalProperties": true
    },
    "resources": {
      "type": "object",
      "description": "Descriptors only. The reader does not access resources.",
      "propertyNames": {
        "$ref": "#/$defs/id"
      },
      "additionalProperties": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "path"
        ],
        "properties": {
          "path": {
            "type": "string",
            "minLength": 1,
            "description": "Bundle-relative POSIX path. Absolute paths, backslashes, URI syntax, and dot/empty segments are rejected."
          }
        }
      }
    }
  },
  "$defs": {
    "id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
    },
    "profileId": {
      "type": "string",
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9][A-Za-z0-9_-]*)+$"
    }
  }
};
