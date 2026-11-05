"""Build a traceable API catalog from cached official Help Center articles.

Usage: python scripts/build_api_catalog.py .local/reference
Cached source documents are private tooling inputs, never application credentials.
"""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from bs4 import BeautifulSoup


def infer(value):
    if isinstance(value, dict):
        return {"type": "object", "properties": {key: infer(item) for key, item in value.items()}, "additionalProperties": False}
    if isinstance(value, list):
        return {"type": "array", "items": infer(value[0]) if value else {"type": "string"}}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    return {"type": "string"}


def find_field(schema, name):
    if schema.get("type") == "object":
        if name in schema.get("properties", {}):
            return schema, schema["properties"][name]
        for child in schema.get("properties", {}).values():
            result = find_field(child, name)
            if result:
                return result
    if schema.get("type") == "array":
        return find_field(schema["items"], name)
    return None


def build(folder: Path):
    operations, guides = [], []
    for file in sorted(folder.glob("*.json")):
        doc = json.loads(file.read_text(encoding="utf-8"))
        meta, article = doc["metadata"], doc["response"]["data"]
        title = meta["artName"].strip()
        soup = BeautifulSoup(article["i18nContent"], "html.parser")
        text = soup.get_text(" ", strip=True)
        source = f"https://zlink-help.minervaiot.com/hc/articles/pc/{meta['catId']}/{meta['artId']}"
        match = re.search(r"Request URL (.*?) Request Method (POST|GET|PUT|DELETE|PATCH)", text)
        if not match or not match[1].startswith("https://zlink-open.minervaiot.com/open-apis/"):
            guides.append(dict(id=meta["artId"], title=title, sections=meta["sections"][1:], source=source))
            continue
        path, method = urlsplit(match[1].strip()).path, match[2]
        params = {"path": [], "query": [], "body": []}
        example = None
        section = ""
        for element in soup.find_all(["h4", "h5", "p", "table", "pre"]):
            label = element.get_text(" ", strip=True)
            if label in ("Request Headers", "Path Parameters", "Query Parameters", "Request Body", "Request Example", "Response Parameters", "Response Example"):
                section = label
            if section == "Request Example":
                candidate = element.get_text("", strip=False).strip()
                candidate = re.sub(r"^json\s*", "", candidate)
                try:
                    parsed = json.loads(candidate)
                    if isinstance(parsed, (dict, list)):
                        example = parsed
                except (ValueError, TypeError):
                    pass
            location = {"Path Parameters": "path", "Query Parameters": "query", "Request Body": "body"}.get(section)
            if element.name == "table" and location:
                for row in element.find_all("tr")[1:]:
                    cells = row.find_all(["td", "th"])
                    if len(cells) >= 4:
                        raw, required, kind, description = [cell.get_text(" ", strip=True) for cell in cells[:4]]
                        if not raw or raw == "Parameter Name":
                            continue
                        params[location].append(dict(name=raw.lstrip("-"), required=required.lower()=="yes", kind=kind.lower(), description=description, depth=(len(raw)-len(raw.lstrip("-")))//2))
        root = {"type": "object", "properties": {}, "additionalProperties": False}
        for location, fields in params.items():
            schema = infer(example) if location == "body" and example is not None else {"type": "object", "properties": {}, "additionalProperties": False}
            stack = {0: schema}
            for item in fields:
                name = item["name"]
                found = find_field(schema, name)
                parent = stack.get(item["depth"], schema)
                kind = {"int":"integer", "integer":"integer", "long":"integer", "float":"number", "double":"number", "boolean":"boolean", "array":"array", "list":"array", "object":"object"}.get(item["kind"], "string")
                field = {"type": kind}
                if found:
                    parent, existing = found
                    # Preserve documented example nesting; retain arrays/objects.
                    field = existing if existing.get("type") in ("array", "object") else field
                    if kind == "string" and existing.get("type") in ("integer", "number"):
                        # Several official tables say string while their JSON
                        # examples send numbers. Accept both and disclose this.
                        field = {"type": ["string", existing["type"]]}
                if kind == "array":
                    field.setdefault("items", {"type":"string"})
                    stack[item["depth"]+1] = field["items"]
                if kind == "object":
                    field.setdefault("properties", {})
                    field["additionalProperties"] = False
                    stack[item["depth"]+1] = field
                if parent.get("type") != "object":
                    parent = schema
                parent.setdefault("properties", {})[name] = field
                if item["required"]:
                    parent.setdefault("required", [])
                    if name not in parent["required"]:
                        parent["required"].append(name)
                description = item["description"]
                for phrase, constraint in ((r"Max length:\s*(\d+)", "maxLength"), (r"Minimum value:\s*(\d+)","minimum"), (r"Maximum value:\s*(\d+)","maximum")):
                    bound = re.search(phrase, description, re.I)
                    if bound and ((constraint == "maxLength" and kind == "string") or (constraint != "maxLength" and kind in ("integer","number"))):
                        field[constraint] = int(bound[1])
                if name == "pageNumber":
                    field.update(default=1, minimum=1)
                if name == "pageSize":
                    field.update(default=10, minimum=1, maximum=100)
                if kind == "string" and "yyyy-MM-dd" in description and "HH:mm" not in description:
                    field["format"] = "date"
                if name == "gender":
                    field["enum"] = ["M","F","O"]
            if fields:
                root["properties"][location] = schema
                if schema.get("required"):
                    root.setdefault("required", []).append(location)
        # Path variables are authoritative even if the article uses another heading.
        variables = re.findall(r"\{([^}]+)\}", path)
        if variables:
            root["properties"].setdefault("path", {"type":"object","properties":{},"additionalProperties":False})
            for variable in variables:
                root["properties"]["path"]["properties"][variable] = {"type":"string", "minLength":1, "maxLength":256, "pattern":"^[A-Za-z0-9_-]+$"}
            root["properties"]["path"]["required"] = variables
            if "path" not in root.setdefault("required", []):
                root["required"].append("path")
        token = "/tenantToken/" in path
        read_only = method == "GET" or path.endswith("/search") or path.endswith("/detect") or token
        operations.append(dict(id=meta["artId"],title=title,sections=meta["sections"][2:],source=source,
                               method=method,path=path,schema=root,example=example,parameters=params,
                               kind="connection" if token else "query" if read_only else "mutation",
                               updated_at=article.get("updateTime")))
    result = dict(source="https://zlink-open.minervaiot.com/external/document",articles=len(operations)+len(guides),operations=operations,guides=guides)
    output=Path(__file__).resolve().parents[1]/"app"/"api_catalog.json"
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"Catalog: {len(operations)} operations, {len(guides)} guides, {len(operations)+len(guides)} source articles")


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("folder",type=Path)
    build(parser.parse_args().folder)
