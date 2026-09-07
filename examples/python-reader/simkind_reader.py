"""Independent draft.2 reader. Structural validation, bounded strict JSON and Markdown.

No TypeScript runtime, host execution, URL resolution, or provider integration.
"""
import argparse
import json
from pathlib import Path
import re
import sys
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "schemas/0.2.0-draft.2/document.schema.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA)
LIMIT = 1024 * 1024


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("Duplicate decoded JSON key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("Non-JSON number: " + value)


def containers(value, depth=0):
    if isinstance(value, (dict, list)):
        if depth >= 64:
            raise ValueError("More than 64 nested containers")
        for child in value.values() if isinstance(value, dict) else value:
            containers(child, depth + 1)


def read_document(source, markdown=False):
    if len(source.encode("utf-8")) > LIMIT:
        raise ValueError("Document exceeds 1 MiB")
    body = None
    if markdown:
        match = re.fullmatch(r"```simkind\r?\n(.*?)\r?\n```(?:\r?\n([\s\S]*))?", source, re.DOTALL)
        if not match:
            raise ValueError("Invalid character Markdown fence")
        source, body = match.groups()
    value = json.loads(source, object_pairs_hook=pairs, parse_constant=reject_constant)
    containers(value)
    if markdown:
        if not isinstance(value, dict) or value.get("kind") != "character":
            raise ValueError("Markdown is for character definitions")
        persona = value.get("persona", {})
        if "description" in persona:
            raise ValueError("Ambiguous Markdown description")
        if body is not None:
            value.setdefault("persona", {})["description"] = body
    errors = sorted(VALIDATOR.iter_errors(value), key=lambda e: list(map(str, e.path)))
    if errors:
        raise ValueError("Schema validation failed: " + errors[0].message)
    for resource in value.get("resources", {}).values():
        path = resource["path"]
        if re.search(r"[\\:%?#\x00-\x1f\x7f]", path) or any(part in ("", ".", "..") for part in path.split("/")):
            raise ValueError("Unsafe resource path")
    for extension in value.get("extensions", {}):
        if extension not in value.get("profiles", {}):
            raise ValueError("Undeclared extension profile")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path)
    args = parser.parse_args()
    with args.document.open("rb") as file:
        raw = file.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError("Document exceeds 1 MiB")
    result = read_document(raw.decode("utf-8", errors="strict"), args.document.suffix == ".md")
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RecursionError) as error:
        print(json.dumps({"ok": False, "diagnostic": str(error)}), file=sys.stderr)
        sys.exit(1)
