"""Test helper for tests/python_client.mjs: what Python sources use that
Python 3.8 lacks, the oldest Python the tfstudio package runs on.

    python -I -B tests/_python38Check.py < sources.json

stdin holds a JSON list of [name, source]; stdout gets one JSON object, the
problems found in each source by its name, each as "line N: what".

Each source is parsed with 3.8's grammar, which ast.parse(feature_version=
(3, 8)) checks, and searched for what that does not check: the names below,
added in 3.9 to 3.12, [...] on a builtin type and | between types, which 3.8
evaluates and refuses at run time, and zip(strict=). A 3.8 interpreter would
see more; this sees what is listed.
"""

import ast
import json
import sys

# Functions, methods, classes and modules added in 3.9 to 3.12 that a program
# here could reach for, by name, or as module.name where the name alone means
# more.
NEWER = {"removeprefix", "removesuffix", "bit_count", "pairwise", "batched", "randbytes",
         "waitstatus_to_exitcode", "is_relative_to", "with_stem", "lcm", "nextafter", "ulp", "to_thread",
         "TaskGroup", "file_digest", "isjunction", "StrEnum", "Annotated", "ParamSpec", "TypeAlias",
         "LiteralString", "aiter", "anext", "ExceptionGroup", "BaseExceptionGroup", "EncodingWarning",
         "zoneinfo", "graphlib", "tomllib", "functools.cache", "datetime.UTC", "typing.Self", "typing.override"}
# Types that take [...] at run time from 3.9, and that take | from 3.10.
GENERIC = {"list", "dict", "tuple", "set", "frozenset", "type"}
TYPES = GENERIC | {"int", "float", "complex", "str", "bytes", "bool", "object"}


def used(node):
    """The names `node` uses, with module.name for an attribute of a module
    or a name imported from one."""
    if isinstance(node, ast.Attribute):
        return [node.attr] + (["{}.{}".format(node.value.id, node.attr)] if isinstance(node.value, ast.Name) else [])
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, ast.Import):
        return [alias.name.split(".")[0] for alias in node.names]
    if isinstance(node, ast.ImportFrom):
        module = node.module or ""
        return [module.split(".")[0]] + [name for alias in node.names for name in (alias.name, module + "." + alias.name)]
    return []


def is_type(node):
    return (isinstance(node, ast.Name) and node.id in TYPES) or (isinstance(node, ast.Constant) and node.value is None)


def newer(node):
    """What `node` uses that Python 3.8 lacks."""
    found = [name for name in used(node) if name in NEWER]
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id in GENERIC:
        found.append(node.value.id + "[...]")
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr) and (is_type(node.left) or is_type(node.right)):
        found.append("| between types")
    if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "zip":
        found += ["zip(strict=)" for keyword in node.keywords if keyword.arg == "strict"]
    return found


def problems(name, source):
    try:
        tree = ast.parse(source, name, feature_version=(3, 8))
    except SyntaxError as err:
        return ["line {}: {}".format(err.lineno, err.msg)]
    return ["line {}: {}".format(node.lineno, what) for node in ast.walk(tree) for what in newer(node)]


if __name__ == "__main__":
    given = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    print(json.dumps({name: problems(name, source) for name, source in given}))
