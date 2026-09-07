// Generated from schemas/0.2.0-draft.2/document.schema.json.
// Run npm run generate:format; do not edit by hand.

export type PortableDocument = Character | CharacterState | Scenario | ToolCatalog | RunConfig | RunBundle;
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Identifier".
 */
export type Identifier = string;
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "JsonValue".
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Clock".
 */
export type Clock =
  | {
      id: Identifier;
      kind: 'tick';
      unit: 'tick';
      origin: string;
    }
  | {
      id: Identifier;
      kind: 'utc';
      unit: 'iso8601';
      origin: string;
    };
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "ProfileId".
 */
export type ProfileId = string;

export interface FormatTypes {
  document?: PortableDocument;
  observation?: Observation;
  proposal?: ActionProposal;
  actionEvent?: ActionEvent;
  runEvent?: RunEvent;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Character".
 */
export interface Character {
  specVersion: '0.2.0-draft.2';
  kind: 'character';
  id: Identifier;
  metadata?: Metadata;
  profiles?: {
    [k: string]: ProfileDeclaration;
  };
  extensions?: {
    [k: string]: JsonValue;
  };
  resources?: {
    [k: string]: ResourceDescriptor;
  };
  name: string;
  persona?: Persona;
  startingState?: CharacterContext;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Metadata".
 */
export interface Metadata {
  title?: string;
  description?: string;
  author?: string;
  license?: string;
  tags?: string[];
  source?: string;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "ProfileDeclaration".
 */
export interface ProfileDeclaration {
  version: string;
  required: boolean;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "ResourceDescriptor".
 */
export interface ResourceDescriptor {
  path: string;
  sha256?: string;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Persona".
 */
export interface Persona {
  description?: string;
  motivations?: string[];
  speakingStyle?: string;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "CharacterContext".
 */
export interface CharacterContext {
  memories?: Memory[];
  intentions?: Intention[];
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Memory".
 */
export interface Memory {
  id: Identifier;
  text: string;
  source: {
    kind: 'authored' | 'observation' | 'report' | 'interpretation';
    origin?: string;
  };
  eventRefs?: HistoricalReference[];
  subjectRefs?: HistoricalReference[];
  reportedBy?: HistoricalReference;
  formedAt?: TimePoint;
  aboutTime?: TimePoint;
  supersedes?: Identifier[];
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "HistoricalReference".
 */
export interface HistoricalReference {
  id: Identifier;
  origin: string;
  resolution: 'recorded' | 'unresolved';
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "TimePoint".
 */
export interface TimePoint {
  clockId: Identifier;
  value: number | string;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Intention".
 */
export interface Intention {
  id: Identifier;
  description: string;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "CharacterState".
 */
export interface CharacterState {
  specVersion: '0.2.0-draft.2';
  kind: 'character-state';
  id: Identifier;
  metadata?: Metadata;
  profiles?: {
    [k: string]: ProfileDeclaration;
  };
  extensions?: {
    [k: string]: JsonValue;
  };
  resources?: {
    [k: string]: ResourceDescriptor;
  };
  instanceId: Identifier;
  definitionRef: Identifier;
  definitionHash: string;
  revision: number;
  context: CharacterContext;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Scenario".
 */
export interface Scenario {
  specVersion: '0.2.0-draft.2';
  kind: 'scenario';
  id: Identifier;
  metadata?: Metadata;
  profiles?: {
    [k: string]: ProfileDeclaration;
  };
  extensions?: {
    [k: string]: JsonValue;
  };
  resources?: {
    [k: string]: ResourceDescriptor;
  };
  host: HostIdentity;
  cast: {
    instanceId: Identifier;
    characterRef: Identifier;
    initialState?: CharacterContext;
    allowedTools?: Identifier[];
  }[];
  initialConditions: JsonObject;
  recommendations?: {
    features?: FeatureSettings;
    modelAssignments?: {
      [k: string]: Identifier;
    };
  };
  toolCatalogRef: Identifier;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "HostIdentity".
 */
export interface HostIdentity {
  contractId: Identifier;
  version: string;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "JsonObject".
 */
export interface JsonObject {
  [k: string]: JsonValue;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "FeatureSettings".
 */
export interface FeatureSettings {
  [k: string]: FeatureSetting;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "FeatureSetting".
 */
export interface FeatureSetting {
  enabled?: boolean;
  config?: JsonObject;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "ToolCatalog".
 */
export interface ToolCatalog {
  specVersion: '0.2.0-draft.2';
  kind: 'tool-catalog';
  id: Identifier;
  metadata?: Metadata;
  profiles?: {
    [k: string]: ProfileDeclaration;
  };
  extensions?: {
    [k: string]: JsonValue;
  };
  resources?: {
    [k: string]: ResourceDescriptor;
  };
  host: HostIdentity;
  tools: ToolDescriptor[];
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "ToolDescriptor".
 */
export interface ToolDescriptor {
  id: Identifier;
  version: string;
  description: string;
  inputSchema: boolean | JsonObject;
  outputSchema?: boolean | JsonObject;
  lifecycle: {
    asynchronous: boolean;
    cancellable: boolean;
  };
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "RunConfig".
 */
export interface RunConfig {
  specVersion: '0.2.0-draft.2';
  kind: 'run-config';
  id: Identifier;
  metadata?: Metadata;
  profiles?: {
    [k: string]: ProfileDeclaration;
  };
  extensions?: {
    [k: string]: JsonValue;
  };
  resources?: {
    [k: string]: ResourceDescriptor;
  };
  modelAssignments: {
    [k: string]: Identifier;
  };
  features?: FeatureSettings;
  perInstance?: {
    [k: string]: InstanceOverride;
  };
  limits: Limits;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "InstanceOverride".
 */
export interface InstanceOverride {
  modelSlot?: Identifier;
  features?: FeatureSettings;
  allowedTools?: Identifier[];
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Limits".
 */
export interface Limits {
  maxRequests: number;
  maxInFlight: number;
  maxSteps: number;
  requestTimeoutMs: number;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "RunBundle".
 */
export interface RunBundle {
  specVersion: '0.2.0-draft.2';
  kind: 'run-bundle';
  id: Identifier;
  metadata?: Metadata;
  profiles?: {
    [k: string]: ProfileDeclaration;
  };
  extensions?: {
    [k: string]: JsonValue;
  };
  resources?: {
    [k: string]: ResourceDescriptor;
  };
  runId: Identifier;
  scenarioRef: Identifier;
  configRef: Identifier;
  host: {
    contractId: Identifier;
    version: string;
    implementationVersion: string;
  };
  clocks: Clock[];
  inputs: Artifact[];
  effectiveConfig: {
    [k: string]: EffectiveInstance;
  };
  limits: Limits;
  eventStreams: {
    path: string;
    sha256: string;
    count: number;
  }[];
  checkpoints: {
    id: Identifier;
    path: string;
    sha256: string;
    boundary: 'settled';
  }[];
  completeness: {
    status: 'complete' | 'truncated';
    missingResources: string[];
    pendingRequests: number;
    unresolvedActions: number;
    inFlightProviders: number;
  };
  capabilities: {
    playback: boolean;
    deterministicReplay: boolean;
    restore: boolean;
    branch: boolean;
  };
  parent?: {
    runId: Identifier;
    checkpointId: Identifier;
    interventionRefs: Identifier[];
  };
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Artifact".
 */
export interface Artifact {
  documentId: Identifier;
  path: string;
  sha256: string;
  compiledPath?: string;
  compiledSha256?: string;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "EffectiveInstance".
 */
export interface EffectiveInstance {
  modelSlot: Identifier;
  model: PublicModel;
  features: FeatureSettings;
  allowedTools: Identifier[];
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "PublicModel".
 */
export interface PublicModel {
  provider: string;
  model: string;
  settings: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "Observation".
 */
export interface Observation {
  id: Identifier;
  runId: Identifier;
  recipient: Identifier;
  source: Identifier;
  capturedAt: TimePoint;
  deliveredAt: TimePoint;
  revision: number;
  content: (
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'data';
        schemaId: Identifier;
        data: JsonValue;
      }
  )[];
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "ActionProposal".
 */
export interface ActionProposal {
  id: Identifier;
  runId: Identifier;
  actor: Identifier;
  requestId: Identifier;
  toolId: Identifier;
  toolVersion: string;
  observedRevision: number;
  arguments: JsonObject;
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "ActionEvent".
 */
export interface ActionEvent {
  id: Identifier;
  runId: Identifier;
  actionId: Identifier;
  actor: Identifier;
  status:
    | 'accepted'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'rejected'
    | 'unknown'
    | 'cancellation-requested'
    | 'cancellation-result';
  time: TimePoint;
  revision: number;
  effectRefs: Identifier[];
  result?: JsonValue;
  reason?: string;
  cancellation?: 'cancelled' | 'unsupported' | 'too-late' | 'pending';
}
/**
 * This interface was referenced by `FormatTypes`'s JSON-Schema
 * via the `definition` "RunEvent".
 */
export interface RunEvent {
  id: Identifier;
  runId: Identifier;
  sequence: number;
  time: TimePoint;
  type:
    'request' | 'model-result' | 'model-error' | 'model-timeout' | 'proposal' | 'action' | 'observation' | 'stopped';
  data: JsonValue;
}

export const documentSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "PortableDocument",
  "oneOf": [
    {
      "$ref": "#/$defs/Character"
    },
    {
      "$ref": "#/$defs/CharacterState"
    },
    {
      "$ref": "#/$defs/Scenario"
    },
    {
      "$ref": "#/$defs/ToolCatalog"
    },
    {
      "$ref": "#/$defs/RunConfig"
    },
    {
      "$ref": "#/$defs/RunBundle"
    }
  ],
  "$defs": {
    "Identifier": {
      "title": "Identifier",
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
    },
    "JsonValue": {
      "title": "JsonValue",
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      ]
    },
    "JsonObject": {
      "title": "JsonObject",
      "type": "object",
      "additionalProperties": {
        "$ref": "#/$defs/JsonValue"
      }
    },
    "ProfileDeclaration": {
      "title": "ProfileDeclaration",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "string",
          "minLength": 1
        },
        "required": {
          "type": "boolean"
        }
      },
      "required": [
        "version",
        "required"
      ]
    },
    "ResourceDescriptor": {
      "title": "ResourceDescriptor",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "path": {
          "type": "string"
        },
        "sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "path"
      ]
    },
    "Metadata": {
      "title": "Metadata",
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
        },
        "source": {
          "type": "string"
        }
      },
      "required": []
    },
    "Persona": {
      "title": "Persona",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "description": {
          "type": "string"
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
      },
      "required": []
    },
    "Clock": {
      "title": "Clock",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "id": {
              "$ref": "#/$defs/Identifier"
            },
            "kind": {
              "const": "tick"
            },
            "unit": {
              "const": "tick"
            },
            "origin": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "kind",
            "unit",
            "origin"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "id": {
              "$ref": "#/$defs/Identifier"
            },
            "kind": {
              "const": "utc"
            },
            "unit": {
              "const": "iso8601"
            },
            "origin": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "kind",
            "unit",
            "origin"
          ]
        }
      ]
    },
    "TimePoint": {
      "title": "TimePoint",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "clockId": {
          "$ref": "#/$defs/Identifier"
        },
        "value": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
            }
          ]
        }
      },
      "required": [
        "clockId",
        "value"
      ]
    },
    "HistoricalReference": {
      "title": "HistoricalReference",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "origin": {
          "type": "string"
        },
        "resolution": {
          "enum": [
            "recorded",
            "unresolved"
          ]
        }
      },
      "required": [
        "id",
        "origin",
        "resolution"
      ]
    },
    "Memory": {
      "title": "Memory",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "text": {
          "type": "string"
        },
        "source": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "enum": [
                "authored",
                "observation",
                "report",
                "interpretation"
              ]
            },
            "origin": {
              "type": "string"
            }
          },
          "required": [
            "kind"
          ]
        },
        "eventRefs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/HistoricalReference"
          }
        },
        "subjectRefs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/HistoricalReference"
          }
        },
        "reportedBy": {
          "$ref": "#/$defs/HistoricalReference"
        },
        "formedAt": {
          "$ref": "#/$defs/TimePoint"
        },
        "aboutTime": {
          "$ref": "#/$defs/TimePoint"
        },
        "supersedes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Identifier"
          }
        }
      },
      "required": [
        "id",
        "text",
        "source"
      ]
    },
    "Intention": {
      "title": "Intention",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "description": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "description"
      ]
    },
    "CharacterContext": {
      "title": "CharacterContext",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "memories": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Memory"
          }
        },
        "intentions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Intention"
          }
        }
      },
      "required": []
    },
    "FeatureSetting": {
      "title": "FeatureSetting",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "config": {
          "$ref": "#/$defs/JsonObject"
        }
      },
      "required": []
    },
    "FeatureSettings": {
      "title": "FeatureSettings",
      "type": "object",
      "propertyNames": {
        "$ref": "#/$defs/ProfileId"
      },
      "additionalProperties": {
        "$ref": "#/$defs/FeatureSetting"
      }
    },
    "InstanceOverride": {
      "title": "InstanceOverride",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "modelSlot": {
          "$ref": "#/$defs/Identifier"
        },
        "features": {
          "$ref": "#/$defs/FeatureSettings"
        },
        "allowedTools": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Identifier"
          }
        }
      },
      "required": []
    },
    "Limits": {
      "title": "Limits",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "maxRequests": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "maxInFlight": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "maxSteps": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "requestTimeoutMs": {
          "type": "integer",
          "minimum": 1,
          "maximum": 2147483647
        }
      },
      "required": [
        "maxRequests",
        "maxInFlight",
        "maxSteps",
        "requestTimeoutMs"
      ]
    },
    "ToolDescriptor": {
      "title": "ToolDescriptor",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "version": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "inputSchema": {
          "oneOf": [
            {
              "type": "boolean"
            },
            {
              "$ref": "#/$defs/JsonObject"
            }
          ]
        },
        "outputSchema": {
          "oneOf": [
            {
              "type": "boolean"
            },
            {
              "$ref": "#/$defs/JsonObject"
            }
          ]
        },
        "lifecycle": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "asynchronous": {
              "type": "boolean"
            },
            "cancellable": {
              "type": "boolean"
            }
          },
          "required": [
            "asynchronous",
            "cancellable"
          ]
        }
      },
      "required": [
        "id",
        "version",
        "description",
        "inputSchema",
        "lifecycle"
      ]
    },
    "HostIdentity": {
      "title": "HostIdentity",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "contractId": {
          "$ref": "#/$defs/Identifier"
        },
        "version": {
          "type": "string"
        }
      },
      "required": [
        "contractId",
        "version"
      ]
    },
    "Observation": {
      "title": "Observation",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "runId": {
          "$ref": "#/$defs/Identifier"
        },
        "recipient": {
          "$ref": "#/$defs/Identifier"
        },
        "source": {
          "$ref": "#/$defs/Identifier"
        },
        "capturedAt": {
          "$ref": "#/$defs/TimePoint"
        },
        "deliveredAt": {
          "$ref": "#/$defs/TimePoint"
        },
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "content": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "type": {
                    "const": "text"
                  },
                  "text": {
                    "type": "string"
                  }
                },
                "required": [
                  "type",
                  "text"
                ]
              },
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "type": {
                    "const": "data"
                  },
                  "schemaId": {
                    "$ref": "#/$defs/Identifier"
                  },
                  "data": {
                    "$ref": "#/$defs/JsonValue"
                  }
                },
                "required": [
                  "type",
                  "schemaId",
                  "data"
                ]
              }
            ]
          }
        }
      },
      "required": [
        "id",
        "runId",
        "recipient",
        "source",
        "capturedAt",
        "deliveredAt",
        "revision",
        "content"
      ]
    },
    "ActionProposal": {
      "title": "ActionProposal",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "runId": {
          "$ref": "#/$defs/Identifier"
        },
        "actor": {
          "$ref": "#/$defs/Identifier"
        },
        "requestId": {
          "$ref": "#/$defs/Identifier"
        },
        "toolId": {
          "$ref": "#/$defs/Identifier"
        },
        "toolVersion": {
          "type": "string"
        },
        "observedRevision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "arguments": {
          "$ref": "#/$defs/JsonObject"
        }
      },
      "required": [
        "id",
        "runId",
        "actor",
        "requestId",
        "toolId",
        "toolVersion",
        "observedRevision",
        "arguments"
      ]
    },
    "ActionEvent": {
      "title": "ActionEvent",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "runId": {
          "$ref": "#/$defs/Identifier"
        },
        "actionId": {
          "$ref": "#/$defs/Identifier"
        },
        "actor": {
          "$ref": "#/$defs/Identifier"
        },
        "status": {
          "enum": [
            "accepted",
            "running",
            "succeeded",
            "failed",
            "cancelled",
            "rejected",
            "unknown",
            "cancellation-requested",
            "cancellation-result"
          ]
        },
        "time": {
          "$ref": "#/$defs/TimePoint"
        },
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "effectRefs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Identifier"
          }
        },
        "result": {
          "$ref": "#/$defs/JsonValue"
        },
        "reason": {
          "type": "string"
        },
        "cancellation": {
          "enum": [
            "cancelled",
            "unsupported",
            "too-late",
            "pending"
          ]
        }
      },
      "required": [
        "id",
        "runId",
        "actionId",
        "actor",
        "status",
        "time",
        "revision",
        "effectRefs"
      ]
    },
    "RunEvent": {
      "title": "RunEvent",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "runId": {
          "$ref": "#/$defs/Identifier"
        },
        "sequence": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "time": {
          "$ref": "#/$defs/TimePoint"
        },
        "type": {
          "enum": [
            "request",
            "model-result",
            "model-error",
            "model-timeout",
            "proposal",
            "action",
            "observation",
            "stopped"
          ]
        },
        "data": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "id",
        "runId",
        "sequence",
        "time",
        "type",
        "data"
      ]
    },
    "PublicModel": {
      "title": "PublicModel",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": {
          "type": "string"
        },
        "model": {
          "type": "string",
          "minLength": 1
        },
        "settings": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "temperature": {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            "maxOutputTokens": {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            }
          },
          "required": []
        }
      },
      "required": [
        "provider",
        "model",
        "settings"
      ]
    },
    "EffectiveInstance": {
      "title": "EffectiveInstance",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "modelSlot": {
          "$ref": "#/$defs/Identifier"
        },
        "model": {
          "$ref": "#/$defs/PublicModel"
        },
        "features": {
          "$ref": "#/$defs/FeatureSettings"
        },
        "allowedTools": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Identifier"
          }
        }
      },
      "required": [
        "modelSlot",
        "model",
        "features",
        "allowedTools"
      ]
    },
    "Artifact": {
      "title": "Artifact",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "documentId": {
          "$ref": "#/$defs/Identifier"
        },
        "path": {
          "type": "string"
        },
        "sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "compiledPath": {
          "type": "string"
        },
        "compiledSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "documentId",
        "path",
        "sha256"
      ]
    },
    "Character": {
      "title": "Character",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "specVersion": {
          "const": "0.2.0-draft.2"
        },
        "kind": {
          "const": "character"
        },
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "metadata": {
          "$ref": "#/$defs/Metadata"
        },
        "profiles": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ProfileDeclaration"
          }
        },
        "extensions": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "resources": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/Identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ResourceDescriptor"
          }
        },
        "name": {
          "type": "string"
        },
        "persona": {
          "$ref": "#/$defs/Persona"
        },
        "startingState": {
          "$ref": "#/$defs/CharacterContext"
        }
      },
      "required": [
        "specVersion",
        "kind",
        "id",
        "name"
      ]
    },
    "CharacterState": {
      "title": "CharacterState",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "specVersion": {
          "const": "0.2.0-draft.2"
        },
        "kind": {
          "const": "character-state"
        },
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "metadata": {
          "$ref": "#/$defs/Metadata"
        },
        "profiles": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ProfileDeclaration"
          }
        },
        "extensions": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "resources": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/Identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ResourceDescriptor"
          }
        },
        "instanceId": {
          "$ref": "#/$defs/Identifier"
        },
        "definitionRef": {
          "$ref": "#/$defs/Identifier"
        },
        "definitionHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "context": {
          "$ref": "#/$defs/CharacterContext"
        }
      },
      "required": [
        "specVersion",
        "kind",
        "id",
        "instanceId",
        "definitionRef",
        "definitionHash",
        "revision",
        "context"
      ]
    },
    "Scenario": {
      "title": "Scenario",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "specVersion": {
          "const": "0.2.0-draft.2"
        },
        "kind": {
          "const": "scenario"
        },
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "metadata": {
          "$ref": "#/$defs/Metadata"
        },
        "profiles": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ProfileDeclaration"
          }
        },
        "extensions": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "resources": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/Identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ResourceDescriptor"
          }
        },
        "host": {
          "$ref": "#/$defs/HostIdentity"
        },
        "cast": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "instanceId": {
                "$ref": "#/$defs/Identifier"
              },
              "characterRef": {
                "$ref": "#/$defs/Identifier"
              },
              "initialState": {
                "$ref": "#/$defs/CharacterContext"
              },
              "allowedTools": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/Identifier"
                }
              }
            },
            "required": [
              "instanceId",
              "characterRef"
            ]
          }
        },
        "initialConditions": {
          "$ref": "#/$defs/JsonObject"
        },
        "recommendations": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "features": {
              "$ref": "#/$defs/FeatureSettings"
            },
            "modelAssignments": {
              "type": "object",
              "propertyNames": {
                "$ref": "#/$defs/Identifier"
              },
              "additionalProperties": {
                "$ref": "#/$defs/Identifier"
              }
            }
          },
          "required": []
        },
        "toolCatalogRef": {
          "$ref": "#/$defs/Identifier"
        }
      },
      "required": [
        "specVersion",
        "kind",
        "id",
        "host",
        "cast",
        "initialConditions",
        "toolCatalogRef"
      ]
    },
    "ToolCatalog": {
      "title": "ToolCatalog",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "specVersion": {
          "const": "0.2.0-draft.2"
        },
        "kind": {
          "const": "tool-catalog"
        },
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "metadata": {
          "$ref": "#/$defs/Metadata"
        },
        "profiles": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ProfileDeclaration"
          }
        },
        "extensions": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "resources": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/Identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ResourceDescriptor"
          }
        },
        "host": {
          "$ref": "#/$defs/HostIdentity"
        },
        "tools": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ToolDescriptor"
          }
        }
      },
      "required": [
        "specVersion",
        "kind",
        "id",
        "host",
        "tools"
      ]
    },
    "RunConfig": {
      "title": "RunConfig",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "specVersion": {
          "const": "0.2.0-draft.2"
        },
        "kind": {
          "const": "run-config"
        },
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "metadata": {
          "$ref": "#/$defs/Metadata"
        },
        "profiles": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ProfileDeclaration"
          }
        },
        "extensions": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "resources": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/Identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ResourceDescriptor"
          }
        },
        "modelAssignments": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/Identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/Identifier"
          }
        },
        "features": {
          "$ref": "#/$defs/FeatureSettings"
        },
        "perInstance": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/Identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/InstanceOverride"
          }
        },
        "limits": {
          "$ref": "#/$defs/Limits"
        }
      },
      "required": [
        "specVersion",
        "kind",
        "id",
        "modelAssignments",
        "limits"
      ]
    },
    "RunBundle": {
      "title": "RunBundle",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "specVersion": {
          "const": "0.2.0-draft.2"
        },
        "kind": {
          "const": "run-bundle"
        },
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "metadata": {
          "$ref": "#/$defs/Metadata"
        },
        "profiles": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ProfileDeclaration"
          }
        },
        "extensions": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/ProfileId"
          },
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "resources": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/Identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ResourceDescriptor"
          }
        },
        "runId": {
          "$ref": "#/$defs/Identifier"
        },
        "scenarioRef": {
          "$ref": "#/$defs/Identifier"
        },
        "configRef": {
          "$ref": "#/$defs/Identifier"
        },
        "host": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "contractId": {
              "$ref": "#/$defs/Identifier"
            },
            "version": {
              "type": "string"
            },
            "implementationVersion": {
              "type": "string"
            }
          },
          "required": [
            "contractId",
            "version",
            "implementationVersion"
          ]
        },
        "clocks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Clock"
          }
        },
        "inputs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Artifact"
          }
        },
        "effectiveConfig": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/Identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/EffectiveInstance"
          }
        },
        "limits": {
          "$ref": "#/$defs/Limits"
        },
        "eventStreams": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "path": {
                "type": "string"
              },
              "sha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "count": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "path",
              "sha256",
              "count"
            ]
          }
        },
        "checkpoints": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "id": {
                "$ref": "#/$defs/Identifier"
              },
              "path": {
                "type": "string"
              },
              "sha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "boundary": {
                "const": "settled"
              }
            },
            "required": [
              "id",
              "path",
              "sha256",
              "boundary"
            ]
          }
        },
        "completeness": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "status": {
              "enum": [
                "complete",
                "truncated"
              ]
            },
            "missingResources": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "pendingRequests": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "unresolvedActions": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "inFlightProviders": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            }
          },
          "required": [
            "status",
            "missingResources",
            "pendingRequests",
            "unresolvedActions",
            "inFlightProviders"
          ]
        },
        "capabilities": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "playback": {
              "type": "boolean"
            },
            "deterministicReplay": {
              "type": "boolean"
            },
            "restore": {
              "type": "boolean"
            },
            "branch": {
              "type": "boolean"
            }
          },
          "required": [
            "playback",
            "deterministicReplay",
            "restore",
            "branch"
          ]
        },
        "parent": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "runId": {
              "$ref": "#/$defs/Identifier"
            },
            "checkpointId": {
              "$ref": "#/$defs/Identifier"
            },
            "interventionRefs": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/Identifier"
              }
            }
          },
          "required": [
            "runId",
            "checkpointId",
            "interventionRefs"
          ]
        }
      },
      "required": [
        "specVersion",
        "kind",
        "id",
        "runId",
        "scenarioRef",
        "configRef",
        "host",
        "clocks",
        "inputs",
        "effectiveConfig",
        "limits",
        "eventStreams",
        "checkpoints",
        "completeness",
        "capabilities"
      ]
    },
    "ProfileId": {
      "title": "ProfileId",
      "type": "string",
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9][A-Za-z0-9_-]*)+$"
    }
  }
};
